import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { SignInAccount } from '@/lib/sign-in-methods'
import { SignInMethods } from './SignInMethods'

// The auth client calls the absolute `getClientBaseURL()` origin, not the
// Storybook origin, so the handlers match any origin.
const LIST = '*/api/auth/list-accounts'
const LINK = '*/api/auth/link-social'
const UNLINK = '*/api/auth/unlink-account'

const PASSWORD: SignInAccount = { id: 'account-password', providerId: 'credential' }
const GOOGLE: SignInAccount = { id: 'account-google', providerId: 'google' }

/** Called by the default unlink handler with the request body. */
const unlinkSpy = fn()

const CONNECT = { name: 'Connect' }
const DISCONNECT = { name: 'Disconnect' }

/** The list endpoint answers with what the story renders, so the refetch on mount changes nothing. */
function listHandler(accounts: SignInAccount[]) {
  return http.get(LIST, () => HttpResponse.json(accounts))
}

const meta = {
  title: 'Feature/Account/SignInMethods',
  component: SignInMethods,
  tags: ['autodocs'],
  args: {
    initialAccounts: [PASSWORD],
    email: 'ann@example.com',
    googleEnabled: true,
    landing: null,
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          '"Sign-in methods" on My account → Profile (HON-1158): a row for the password and one for Google. Connect shows only when Google is on and not linked; it starts `linkSocial`, and the callback lands on `/account?linked=google`, where this section says how it went once. Disconnect shows only when a password exists too, so the account always keeps a way in. With the provider off, the password row shows alone. Errors show catalog copy; focus returns to the button after a failure and moves to Connect after Disconnect.',
      },
    },
    msw: {
      handlers: [
        listHandler([PASSWORD]),
        http.post(UNLINK, async ({ request }) => {
          unlinkSpy(await request.json())
          return HttpResponse.json({ status: true })
        }),
      ],
    },
  },
} satisfies Meta<typeof SignInMethods>

export default meta
type Story = StoryObj<typeof meta>

export const PasswordOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [password, google] = canvas.getAllByRole('listitem')
    await expect(password).toHaveTextContent('PasswordSet')
    await expect(google).toHaveTextContent('GoogleNot connected')
    await expect(canvas.getByRole('button', CONNECT)).toBeEnabled()
    await expect(canvas.queryByRole('button', DISCONNECT)).not.toBeInTheDocument()
  },
}

export const GoogleOnly: Story = {
  args: { initialAccounts: [GOOGLE] },
  parameters: { msw: { handlers: [listHandler([GOOGLE])] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [password, google] = canvas.getAllByRole('listitem')
    await expect(password).toHaveTextContent('PasswordNot set')
    await expect(google).toHaveTextContent('Googleann@example.com')
    // Google is the only way in, so it cannot be disconnected.
    await expect(canvas.queryByRole('button')).not.toBeInTheDocument()
  },
}

export const Both: Story = {
  args: { initialAccounts: [PASSWORD, GOOGLE] },
  parameters: {
    msw: {
      handlers: [
        listHandler([PASSWORD, GOOGLE]),
        http.post(UNLINK, () => HttpResponse.json({ status: true })),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [password, google] = canvas.getAllByRole('listitem')
    await expect(password).toHaveTextContent('PasswordSet')
    await expect(google).toHaveTextContent('Googleann@example.com')
    await expect(canvas.getByRole('button', DISCONNECT)).toBeEnabled()
  },
}

export const ProviderOff: Story = {
  args: { initialAccounts: [PASSWORD], googleEnabled: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('listitem')).toHaveLength(1)
    await expect(canvas.queryByRole('button')).not.toBeInTheDocument()
  },
}

export const Connected: Story = {
  args: { initialAccounts: [PASSWORD, GOOGLE], landing: { kind: 'linked' } },
  parameters: { msw: { handlers: [listHandler([PASSWORD, GOOGLE])] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent('Google connected.')
  },
}

export const LinkRefused: Story = {
  args: { landing: { kind: 'failed', errorKey: 'googleLinkedElsewhere' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'This Google account is already connected to another Wobblepot account.',
    )
    await expect(canvas.getByRole('button', CONNECT)).toBeEnabled()
  },
}

// A refused request never leaves the page; a successful one would send the
// Storybook frame to Google, so no story clicks Connect with a 200.
export const ConnectRefused: Story = {
  parameters: {
    msw: {
      handlers: [
        listHandler([PASSWORD]),
        http.post(LINK, () =>
          HttpResponse.json(
            { code: 'PROVIDER_NOT_FOUND', message: 'Provider not found' },
            { status: 404 },
          ),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', CONNECT))
    await waitFor(() =>
      expect(canvas.getByRole('alert')).toHaveTextContent('Google did not open. Try again.'),
    )
    await waitFor(() => expect(canvas.getByRole('button', CONNECT)).toHaveFocus())
  },
}

export const Disconnect: Story = {
  args: { initialAccounts: [PASSWORD, GOOGLE] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    unlinkSpy.mockClear()
    await userEvent.click(canvas.getByRole('button', DISCONNECT))
    await waitFor(() => expect(canvas.getByRole('button', CONNECT)).toHaveFocus())
    await expect(unlinkSpy).toHaveBeenCalledWith({ accountId: 'account-google' })
    await expect(canvas.getAllByRole('listitem')[1]).toHaveTextContent('GoogleNot connected')
  },
}

export const Disconnecting: Story = {
  args: { initialAccounts: [PASSWORD, GOOGLE] },
  parameters: {
    msw: {
      handlers: [
        listHandler([PASSWORD, GOOGLE]),
        http.post(UNLINK, async () => {
          await delay('infinite')
          return HttpResponse.json({ status: true })
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', DISCONNECT))
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Disconnecting…' })).toBeDisabled(),
    )
  },
}

export const DisconnectNeedsNewSignIn: Story = {
  args: { initialAccounts: [PASSWORD, GOOGLE] },
  parameters: {
    msw: {
      handlers: [
        listHandler([PASSWORD, GOOGLE]),
        http.post(UNLINK, () =>
          HttpResponse.json(
            { code: 'SESSION_NOT_FRESH', message: 'Session is not fresh' },
            { status: 403 },
          ),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', DISCONNECT))
    await waitFor(() =>
      expect(canvas.getByRole('alert')).toHaveTextContent(
        'To disconnect Google, sign out and sign in again first.',
      ),
    )
    await waitFor(() => expect(canvas.getByRole('button', DISCONNECT)).toHaveFocus())
  },
}
