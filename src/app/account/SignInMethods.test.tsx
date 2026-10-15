import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { authClient } from '@/lib/auth-client'
import { createQueryWrapper } from '@/test/query-wrapper'
import type { GoogleLinkLanding, SignInAccount } from '@/lib/sign-in-methods'
import { SignInMethods } from './SignInMethods'

vi.mock('@/lib/auth-client', () => ({
  authClient: { listAccounts: vi.fn(), linkSocial: vi.fn(), unlinkAccount: vi.fn() },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const PASSWORD: SignInAccount = { id: 'account-password', providerId: 'credential' }
const GOOGLE: SignInAccount = { id: 'account-google', providerId: 'google' }

const mockList = vi.mocked(authClient.listAccounts)
const mockLink = vi.mocked(authClient.linkSocial)
const mockUnlink = vi.mocked(authClient.unlinkAccount)

function listResult(accounts: SignInAccount[]) {
  return { data: accounts, error: null } as unknown as Awaited<
    ReturnType<typeof authClient.listAccounts>
  >
}
function failed(status: number, code?: string, message = 'Server said no') {
  return { data: null, error: { status, code, message } } as never
}

function renderSection({
  accounts = [PASSWORD],
  googleEnabled = true,
  landing = null,
}: {
  accounts?: SignInAccount[]
  googleEnabled?: boolean
  landing?: GoogleLinkLanding | null
} = {}) {
  mockList.mockResolvedValue(listResult(accounts))
  return render(
    <SignInMethods
      initialAccounts={accounts}
      email="ann@example.com"
      googleEnabled={googleEnabled}
      landing={landing}
    />,
    { wrapper: createQueryWrapper().wrapper },
  )
}

const rows = () => within(screen.getByRole('list')).getAllByRole('listitem')
const CONNECT = { name: 'Connect' }
const DISCONNECT = { name: 'Disconnect' }

describe('SignInMethods', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('labels the section with its heading', () => {
    renderSection()

    expect(screen.getByRole('region', { name: 'Sign-in methods' })).toBeInTheDocument()
  })

  describe('rows', () => {
    it('password only: the password is set, Google is not connected', () => {
      renderSection({ accounts: [PASSWORD] })

      const [password, google] = rows()
      expect(password).toHaveTextContent('PasswordSet')
      expect(google).toHaveTextContent('GoogleNot connected')
      expect(within(google!).getByRole('button', CONNECT)).toBeEnabled()
      expect(screen.queryByRole('button', DISCONNECT)).not.toBeInTheDocument()
    })

    it('Google only: no password, Google shows the email, and no Disconnect', () => {
      renderSection({ accounts: [GOOGLE] })

      const [password, google] = rows()
      expect(password).toHaveTextContent('PasswordNot set')
      expect(google).toHaveTextContent('Googleann@example.com')
      expect(screen.queryByRole('button', CONNECT)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', DISCONNECT)).not.toBeInTheDocument()
    })

    it('both: Google shows the email and Disconnect', () => {
      renderSection({ accounts: [PASSWORD, GOOGLE] })

      const [password, google] = rows()
      expect(password).toHaveTextContent('PasswordSet')
      expect(google).toHaveTextContent('Googleann@example.com')
      expect(within(google!).getByRole('button', DISCONNECT)).toBeEnabled()
      expect(screen.queryByRole('button', CONNECT)).not.toBeInTheDocument()
    })

    it('provider off: the password row only', () => {
      renderSection({ accounts: [PASSWORD, GOOGLE], googleEnabled: false })

      expect(rows()).toHaveLength(1)
      expect(rows()[0]).toHaveTextContent('PasswordSet')
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  describe('Connect', () => {
    it('starts linkSocial with the account callback for both outcomes', async () => {
      mockLink.mockResolvedValue({
        data: { url: 'https://accounts.google.com', redirect: true },
        error: null,
      } as never)
      const user = userEvent.setup()
      renderSection()

      await user.click(screen.getByRole('button', CONNECT))

      expect(mockLink).toHaveBeenCalledWith({
        provider: 'google',
        callbackURL: '/account?linked=google',
        errorCallbackURL: '/account?linked=google',
      })
      // The browser is leaving for Google: the button stays disabled.
      expect(await screen.findByRole('button', { name: 'Opening Google…' })).toBeDisabled()
    })

    it('shows catalog copy and returns focus when the request is refused', async () => {
      mockLink.mockResolvedValue(failed(404, 'PROVIDER_NOT_FOUND', 'Provider not found'))
      const user = userEvent.setup()
      renderSection()

      await user.click(screen.getByRole('button', CONNECT))

      expect(await screen.findByRole('alert')).toHaveTextContent('Google did not open. Try again.')
      expect(screen.queryByText('Provider not found')).not.toBeInTheDocument()
      await waitFor(() => expect(screen.getByRole('button', CONNECT)).toHaveFocus())
    })

    it('shows the rate-limit copy on a 429', async () => {
      mockLink.mockResolvedValue(failed(429))
      const user = userEvent.setup()
      renderSection()

      await user.click(screen.getByRole('button', CONNECT))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Too many attempts. Please try again in a few minutes.',
      )
    })
  })

  describe('Disconnect', () => {
    it('unlinks the Google account row and refreshes the list', async () => {
      mockUnlink.mockResolvedValue({ data: { status: true }, error: null } as never)
      const user = userEvent.setup()
      renderSection({ accounts: [PASSWORD, GOOGLE] })
      // The server now has the password only.
      mockList.mockResolvedValue(listResult([PASSWORD]))

      await user.click(screen.getByRole('button', DISCONNECT))

      expect(mockUnlink).toHaveBeenCalledWith({ accountId: 'account-google' })
      expect(await screen.findByRole('button', CONNECT)).toBeInTheDocument()
      expect(rows()[1]).toHaveTextContent('GoogleNot connected')
      expect(toast.success).toHaveBeenCalledWith('Google disconnected.')
      await waitFor(() => expect(mockList).toHaveBeenCalled())
    })

    it('moves focus to Connect, since Disconnect goes away', async () => {
      mockUnlink.mockResolvedValue({ data: { status: true }, error: null } as never)
      const user = userEvent.setup()
      renderSection({ accounts: [PASSWORD, GOOGLE] })
      mockList.mockResolvedValue(listResult([PASSWORD]))

      await user.click(screen.getByRole('button', DISCONNECT))

      await waitFor(() => expect(screen.getByRole('button', CONNECT)).toHaveFocus())
    })

    it('asks for a new sign-in when the session is too old', async () => {
      mockUnlink.mockResolvedValue(failed(403, 'SESSION_NOT_FRESH', 'Session is not fresh'))
      const user = userEvent.setup()
      renderSection({ accounts: [PASSWORD, GOOGLE] })

      await user.click(screen.getByRole('button', DISCONNECT))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'To disconnect Google, sign out and sign in again first.',
      )
      expect(screen.queryByText('Session is not fresh')).not.toBeInTheDocument()
      await waitFor(() => expect(screen.getByRole('button', DISCONNECT)).toHaveFocus())
    })

    it('shows the generic copy on any other failure', async () => {
      mockUnlink.mockResolvedValue(failed(500))
      const user = userEvent.setup()
      renderSection({ accounts: [PASSWORD, GOOGLE] })

      await user.click(screen.getByRole('button', DISCONNECT))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Google was not disconnected. Try again.',
      )
      expect(screen.getByRole('button', DISCONNECT)).toBeInTheDocument()
    })
  })

  describe('after the Connect callback', () => {
    it('says Google is connected and clears the params from the URL', async () => {
      window.history.replaceState(null, '', '/account?linked=google&tab=x')
      renderSection({ accounts: [PASSWORD, GOOGLE], landing: { kind: 'linked' } })

      expect(screen.getByRole('status')).toHaveTextContent('Google connected.')
      await waitFor(() => expect(window.location.search).toBe('?tab=x'))
    })

    it('shows catalog copy for a refused link and clears the params', async () => {
      window.history.replaceState(null, '', '/account?linked=google&error=email_does_not_match')
      renderSection({ landing: { kind: 'failed', errorKey: 'googleLinkEmailMismatch' } })

      expect(screen.getByRole('status')).toHaveTextContent(
        'Use the Google account with the same email address as your Wobblepot account.',
      )
      await waitFor(() => expect(window.location.search).toBe(''))
    })

    it('leaves the URL alone without a landing', () => {
      window.history.replaceState(null, '', '/account?error=TOKEN_EXPIRED')
      renderSection()

      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(window.location.search).toBe('?error=TOKEN_EXPIRED')
    })
  })
})
