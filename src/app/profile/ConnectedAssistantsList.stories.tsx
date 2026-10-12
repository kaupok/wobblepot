import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ConnectedAssistantsList, type ConnectedAssistant } from './ConnectedAssistantsList'

const LIST = '*/api/auth/user/mcp-consents'
const DELETE_ONE = '*/api/auth/user/mcp-consents/:clientId'

const CLAUDE: ConnectedAssistant = {
  clientId: 'client-claude',
  clientName: 'Claude',
  scopes: ['openid', 'profile', 'offline_access', 'mcp:read', 'mcp:write'],
  createdAt: '2026-10-02T18:00:00.000Z',
}
const THREE: ConnectedAssistant[] = [
  CLAUDE,
  {
    clientId: 'client-desktop',
    clientName: 'Claude Desktop',
    scopes: ['offline_access', 'mcp:read'],
    createdAt: '2026-10-05T09:30:00.000Z',
  },
  { clientId: 'client-unnamed', clientName: null, scopes: ['mcp:read'], createdAt: null },
]

/** Called by the DELETE handler, so a play function can assert the mutation ran. */
const disconnectSpy = fn()

function handlers(rows: ConnectedAssistant[]) {
  let current = rows
  return [
    http.get(LIST, () => HttpResponse.json(current)),
    http.delete(DELETE_ONE, ({ params }) => {
      disconnectSpy(params.clientId)
      current = current.filter((row) => row.clientId !== params.clientId)
      return new HttpResponse(null, { status: 204 })
    }),
  ]
}

const meta = {
  title: 'Feature/Profile/ConnectedAssistantsList',
  component: ConnectedAssistantsList,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The "Connected assistants" list on `/profile` (HON-1153): one row per AI assistant the user allowed on `/consent`, with the date, the scopes in plain words and Disconnect. Disconnect asks first, then deletes the consent and tokens through `DELETE /api/auth/user/mcp-consents/[clientId]`.',
      },
    },
    msw: { handlers: handlers([CLAUDE]) },
  },
  args: { initialConsents: [CLAUDE] },
  beforeEach: () => {
    disconnectSpy.mockClear()
  },
} satisfies Meta<typeof ConnectedAssistantsList>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  args: { initialConsents: [] },
  parameters: { msw: { handlers: handlers([]) } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('No assistant is connected.')).toBeInTheDocument()
  },
}

export const OneAssistant: Story = {}

export const ThreeAssistants: Story = {
  args: { initialConsents: THREE },
  parameters: { msw: { handlers: handlers(THREE) } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole('listitem')).toHaveLength(3)
    await expect(within(canvasElement).getByText('Unnamed assistant')).toBeInTheDocument()
  },
}

export const Estonian: Story = {
  args: { initialConsents: THREE },
  parameters: { msw: { handlers: handlers(THREE) } },
  globals: { locale: 'et' },
}

/** Open, Escape closes without a request, then confirm runs the DELETE. */
export const ConfirmDisconnect: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)
    const trigger = canvas.getByRole('button', { name: 'Disconnect: Claude' })

    await userEvent.click(trigger)
    let dialog = await body.findByRole('alertdialog', { name: 'Disconnect Claude?' })
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('alertdialog')).not.toBeInTheDocument())
    await expect(disconnectSpy).not.toHaveBeenCalled()
    await waitFor(() => expect(trigger).toHaveFocus())

    await userEvent.click(trigger)
    dialog = await body.findByRole('alertdialog', { name: 'Disconnect Claude?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }))

    await waitFor(() => expect(disconnectSpy).toHaveBeenCalledWith('client-claude'))
    await waitFor(() => expect(body.queryByRole('alertdialog')).not.toBeInTheDocument())
    await expect(await canvas.findByText('No assistant is connected.')).toBeInTheDocument()
  },
}

export const DisconnectPending: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(LIST, () => HttpResponse.json([CLAUDE])),
        http.delete(DELETE_ONE, async () => {
          await delay('infinite')
          return new HttpResponse(null, { status: 204 })
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const body = within(document.body)
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Disconnect: Claude' }))
    const dialog = await body.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Disconnecting…' })).toBeDisabled(),
    )
    await expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
  },
}
