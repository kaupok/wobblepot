import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ApiKeysSection, NewApiKey, type ApiKeyRow } from './ApiKeysSection'

const LIST = '*/api/auth/user/api-keys'
const DELETE_ONE = '*/api/auth/user/api-keys/:id'

const NEW_KEY = 'wp_Qr7sTuVwXyZ0123456789abcdefghij'

const KITCHEN: ApiKeyRow = {
  id: 'key-kitchen',
  name: 'Kitchen screen',
  start: 'wp_Ab3dEf',
  createdAt: '2026-10-02T18:00:00.000Z',
  lastUsedAt: '2026-10-13T07:15:00.000Z',
  expiresAt: null,
  expired: false,
  memberName: null,
}
const TWO: ApiKeyRow[] = [
  KITCHEN,
  {
    id: 'key-script',
    name: 'Shopping script',
    start: 'wp_Zx9yWv',
    createdAt: '2026-10-05T09:30:00.000Z',
    lastUsedAt: null,
    expiresAt: null,
    expired: false,
    memberName: null,
  },
]

/** One key that expires later, one that has expired (HON-1221). */
const WITH_EXPIRY: ApiKeyRow[] = [
  { ...KITCHEN, expiresAt: '2026-11-13T07:15:00.000Z' },
  { ...TWO[1]!, expiresAt: '2026-10-06T09:30:00.000Z', expired: true },
]

/** The owner's view: every member's keys, each with its member (HON-1221). */
const HOUSEHOLD: ApiKeyRow[] = [
  { ...KITCHEN, memberName: 'Kaupo' },
  { ...TWO[1]!, memberName: 'Jane' },
]

/** Called by the DELETE handler, so a play function can assert the mutation ran. */
const revokeSpy = fn()
/** Called by the POST handler with the body it got. */
const createSpy = fn()

function handlers(rows: ApiKeyRow[]) {
  let current = rows
  return [
    http.get(LIST, () => HttpResponse.json(current)),
    http.post(LIST, async ({ request }) => {
      const { name, expiresInDays } = (await request.json()) as {
        name: string
        expiresInDays: number | null
      }
      createSpy({ name, expiresInDays })
      const apiKey: ApiKeyRow = {
        id: `key-${current.length + 1}`,
        name,
        start: NEW_KEY.slice(0, 9),
        createdAt: '2026-10-14T10:00:00.000Z',
        lastUsedAt: null,
        expiresAt: null,
        expired: false,
        memberName: null,
      }
      current = [...current, apiKey]
      return HttpResponse.json({ key: NEW_KEY, apiKey }, { status: 201 })
    }),
    http.delete(DELETE_ONE, ({ params }) => {
      revokeSpy(params.id)
      current = current.filter((row) => row.id !== params.id)
      return new HttpResponse(null, { status: 204 })
    }),
  ]
}

const meta = {
  title: 'Feature/Profile/ApiKeysSection',
  component: ApiKeysSection,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The "Screens and scripts" section on `/profile` (HON-1220): name a read-only API key, optionally set it to expire, create it, copy it from the panel that shows it once, and revoke it. The household\'s owner sees and revokes every member\'s keys (HON-1221). The key reads `GET /api/v1/meal-plan` and `GET /api/v1/shopping-list` only.',
      },
    },
    msw: { handlers: handlers([KITCHEN]) },
  },
  args: { initialKeys: [KITCHEN], timeZone: 'Europe/Tallinn', householdView: false },
  beforeEach: () => {
    revokeSpy.mockClear()
    createSpy.mockClear()
  },
} satisfies Meta<typeof ApiKeysSection>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  args: { initialKeys: [] },
  parameters: { msw: { handlers: handlers([]) } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('You have no keys.')).toBeInTheDocument()
  },
}

export const OneKey: Story = {}

export const TwoKeys: Story = {
  args: { initialKeys: TWO },
  parameters: { msw: { handlers: handlers(TWO) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('listitem')).toHaveLength(2)
    await expect(canvas.getByText('Not used yet')).toBeInTheDocument()
  },
}

export const Estonian: Story = {
  args: { initialKeys: TWO },
  parameters: { msw: { handlers: handlers(TWO) } },
  globals: { locale: 'et' },
}

/** A key with an expiry date and a key that has expired (HON-1221). */
export const WithExpiry: Story = {
  args: { initialKeys: WITH_EXPIRY },
  parameters: { msw: { handlers: handlers(WITH_EXPIRY) } },
  play: async ({ canvasElement }) => {
    const [later, past] = within(canvasElement).getAllByRole('listitem')
    await expect(within(later!).getByText('Expires: November 13, 2026')).toBeInTheDocument()
    await expect(within(past!).getByText('Expired')).toBeInTheDocument()
  },
}

export const WithExpiryEstonian: Story = {
  args: { initialKeys: WITH_EXPIRY },
  parameters: { msw: { handlers: handlers(WITH_EXPIRY) } },
  globals: { locale: 'et' },
}

/** The owner sees every member's keys, each with the member's name (HON-1221). */
export const HouseholdView: Story = {
  args: { initialKeys: HOUSEHOLD, householdView: true },
  parameters: { msw: { handlers: handlers(HOUSEHOLD) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'Household keys' })).toBeInTheDocument()
    await expect(canvas.getByText('Member: Jane')).toBeInTheDocument()
    await expect(
      canvas.getByRole('button', { name: 'Revoke: Shopping script, Jane' }),
    ).toBeInTheDocument()
  },
}

export const HouseholdViewEmpty: Story = {
  args: { initialKeys: [], householdView: true },
  parameters: { msw: { handlers: handlers([]) } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('No one in the household has a key.'),
    ).toBeInTheDocument()
  },
}

export const HouseholdViewEstonian: Story = {
  args: { initialKeys: HOUSEHOLD, householdView: true },
  parameters: { msw: { handlers: handlers(HOUSEHOLD) } },
  globals: { locale: 'et' },
}

/** An expiry that is not a whole number from 1 to 365 is refused before the request. */
export const ExpiryInvalid: Story = {
  args: { initialKeys: [] },
  parameters: { msw: { handlers: handlers([]) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Key name'), 'Kitchen screen')
    await userEvent.type(canvas.getByLabelText('Expires in (optional)'), '400')
    await userEvent.click(canvas.getByRole('button', { name: 'Create key' }))

    await expect(
      canvas.getByText('Enter a whole number of days from 1 to 365.'),
    ).toBeInTheDocument()
    await waitFor(() => expect(canvas.getByLabelText('Expires in (optional)')).toHaveFocus())
    await expect(createSpy).not.toHaveBeenCalled()
  },
}

/** Create shows the key once, with focus on its heading; Done hides it. */
export const CreateShowsKeyOnce: Story = {
  args: { initialKeys: [] },
  parameters: { msw: { handlers: handlers([]) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Key name'), 'Kitchen screen')
    await userEvent.type(canvas.getByLabelText('Expires in (optional)'), '30')
    await userEvent.click(canvas.getByRole('button', { name: 'Create key' }))

    const heading = await canvas.findByRole('heading', { name: 'New key: Kitchen screen' })
    await expect(createSpy).toHaveBeenCalledWith({ name: 'Kitchen screen', expiresInDays: 30 })
    await waitFor(() => expect(heading.parentElement).toHaveFocus())
    await expect(canvas.getByText(NEW_KEY)).toBeInTheDocument()

    await userEvent.click(canvas.getByRole('button', { name: 'Done' }))
    await expect(canvas.queryByText(NEW_KEY)).not.toBeInTheDocument()
    await waitFor(() => expect(canvas.getByLabelText('Key name')).toHaveFocus())
  },
}

/** The panel on its own, as it looks right after Create. */
export const KeyShownOnce: StoryObj<typeof NewApiKey> = {
  render: () => <NewApiKey created={{ key: NEW_KEY, name: 'Kitchen screen' }} onDone={fn()} />,
}

export const KeyShownOnceEstonian: StoryObj<typeof NewApiKey> = {
  ...KeyShownOnce,
  globals: { locale: 'et' },
}

export const KeyLimit: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(LIST, () => HttpResponse.json([KITCHEN])),
        http.post(LIST, () =>
          HttpResponse.json({ error: 'Too many API keys', code: 'key_limit' }, { status: 400 }),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Key name'), 'One too many')
    await userEvent.click(canvas.getByRole('button', { name: 'Create key' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'You have 10 keys, the most you can have. Revoke one to create another.',
    )
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Create key' })).toHaveFocus())
  },
}

export const CreatePending: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(LIST, () => HttpResponse.json([KITCHEN])),
        http.post(LIST, async () => {
          await delay('infinite')
          return HttpResponse.json({})
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Key name'), 'Kitchen screen')
    await userEvent.click(canvas.getByRole('button', { name: 'Create key' }))
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Creating…' })).toBeDisabled())
    await expect(canvas.getByLabelText('Key name')).toBeDisabled()
  },
}

/** Open, Escape closes without a request, then confirm runs the DELETE. */
export const ConfirmRevoke: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)
    const trigger = canvas.getByRole('button', { name: 'Revoke: Kitchen screen' })

    await userEvent.click(trigger)
    let dialog = await body.findByRole('alertdialog', { name: 'Revoke Kitchen screen?' })
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('alertdialog')).not.toBeInTheDocument())
    await expect(revokeSpy).not.toHaveBeenCalled()
    await waitFor(() => expect(trigger).toHaveFocus())

    await userEvent.click(trigger)
    dialog = await body.findByRole('alertdialog', { name: 'Revoke Kitchen screen?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }))

    await waitFor(() => expect(revokeSpy).toHaveBeenCalledWith('key-kitchen'))
    await waitFor(() => expect(body.queryByRole('alertdialog')).not.toBeInTheDocument())
    await expect(await canvas.findByText('You have no keys.')).toBeInTheDocument()
  },
}
