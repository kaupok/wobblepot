import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ConsentCard } from './ConsentCard'

// `authClient.oauth2.consent()` posts to `/api/auth/oauth2/consent` on the
// absolute `getClientBaseURL()` origin, so the handler matches any origin.
const CONSENT = '*/api/auth/oauth2/consent'

/**
 * Records each consent body and never answers. A success answer would make
 * the auth client's redirect plugin navigate the Storybook frame to the
 * client's redirect URI, so the stories stop at the pending state.
 */
const receivedBody = fn()
const pendingConsent = http.post(CONSENT, async ({ request }) => {
  receivedBody(await request.json())
  await delay('infinite')
  return HttpResponse.json({})
})

const meta = {
  title: 'Feature/Auth/ConsentCard',
  component: ConsentCard,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'The `/consent` step when an MCP client such as Claude connects to Wobblepot (HON-1150). It names the app and the household, lists what the app can do in plain words, and sends Allow or Deny to the OAuth provider. On success the auth client sends the browser back to the app; on an error the card shows catalog copy and returns focus to the button.',
      },
    },
    msw: { handlers: [pendingConsent] },
  },
  args: {
    status: 'ready',
    clientName: 'Claude',
    householdName: 'Kõrvid',
    scopes: ['mcp:read', 'openid', 'profile', 'offline_access'],
  },
} satisfies Meta<typeof ConsentCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const UnnamedApp: Story = {
  args: { clientName: null },
}

export const NoHousehold: Story = {
  args: { householdName: null, scopes: ['mcp:read', 'offline_access'] },
  parameters: {
    docs: {
      description: { story: 'A user who has not finished onboarding has no household line.' },
    },
  },
}

export const Invalid: Story = {
  args: { status: 'invalid' },
  parameters: {
    docs: {
      description: {
        story:
          'The signed request is missing, expired, or names an app that is not registered. Nothing from the URL is shown.',
      },
    },
  },
}

export const AllowPending: Story = {
  play: async ({ canvasElement }) => {
    receivedBody.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Connecting…' })).toBeDisabled())
    await expect(canvas.getByRole('button', { name: 'Deny' })).toBeDisabled()
    await waitFor(() =>
      expect(receivedBody).toHaveBeenCalledWith(expect.objectContaining({ accept: true })),
    )
  },
}

export const DenyPending: Story = {
  play: async ({ canvasElement }) => {
    receivedBody.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Cancelling…' })).toBeDisabled())
    await waitFor(() =>
      expect(receivedBody).toHaveBeenCalledWith(expect.objectContaining({ accept: false })),
    )
  },
}

export const Failed: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post(CONSENT, () =>
          HttpResponse.json(
            { error: 'invalid_signature', error_description: 'invalid signature' },
            { status: 400 },
          ),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const allow = canvas.getByRole('button', { name: 'Allow' })
    await userEvent.click(allow)
    await expect(
      await canvas.findByText('Could not finish connecting. Start again from the app.'),
    ).toBeInTheDocument()
    await waitFor(() => expect(allow).toBeEnabled())
    await expect(canvas.queryByText(/invalid signature/i)).not.toBeInTheDocument()
  },
}
