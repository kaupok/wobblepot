import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authClient } from '@/lib/auth-client'
import { createQueryWrapper } from '@/test/query-wrapper'
import { dropFocusToBody } from '@/test/focus'
import type { VerificationLanding } from '@/lib/email-verification'
import { VerifyEmailNotice } from './VerifyEmailNotice'

vi.mock('@/lib/auth-client', () => ({
  authClient: { sendVerificationEmail: vi.fn() },
}))

type SendResult = Awaited<ReturnType<typeof authClient.sendVerificationEmail>>

const ok = { data: { status: true }, error: null } as unknown as SendResult
function failed(status: number, code?: string, message = 'Server said no') {
  return { data: null, error: { status, code, message } } as unknown as SendResult
}

const mockSend = vi.mocked(authClient.sendVerificationEmail)

function renderNotice({
  emailVerified = false,
  landing = null,
}: { emailVerified?: boolean; landing?: VerificationLanding | null } = {}) {
  return render(
    <VerifyEmailNotice email="ann@example.com" emailVerified={emailVerified} landing={landing} />,
    { wrapper: createQueryWrapper().wrapper },
  )
}

const RESEND = { name: 'Send the link again' }

describe('VerifyEmailNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  describe('while the address is not verified', () => {
    it('says so and offers Resend', () => {
      renderNotice()

      expect(screen.getByRole('status')).toHaveTextContent(
        'Your email address is not verified yet. Open the link in the email we sent you.',
      )
      expect(screen.getByRole('button', RESEND)).toBeEnabled()
    })

    it('says the link expired after an expired link', () => {
      renderNotice({ landing: 'expired' })

      expect(screen.getByRole('status')).toHaveTextContent(
        'This verification link has expired. Send a new one.',
      )
      expect(screen.getByRole('button', RESEND)).toBeInTheDocument()
    })

    it('says the link does not work after a broken link', () => {
      renderNotice({ landing: 'invalid' })

      expect(screen.getByRole('status')).toHaveTextContent(
        'This verification link does not work. Send a new one.',
      )
    })

    // `verified=1` with the flag still false: the link verified some other
    // account (another user's link opened in this browser).
    it('shows the plain notice after a landing that did not verify this account', () => {
      renderNotice({ landing: 'verified' })

      expect(screen.getByRole('status')).toHaveTextContent('is not verified yet')
    })
  })

  describe('Resend', () => {
    it('sends the link to the account email with the profile callback', async () => {
      mockSend.mockResolvedValue(ok)
      const user = userEvent.setup()
      renderNotice()

      await user.click(screen.getByRole('button', RESEND))

      expect(mockSend).toHaveBeenCalledWith({
        email: 'ann@example.com',
        callbackURL: '/profile?verified=1',
      })
      expect(await screen.findByText('Sent. Check your inbox.')).toBeInTheDocument()
      expect(screen.queryByRole('button', RESEND)).not.toBeInTheDocument()
    })

    it('moves focus to the sent message, since the button goes away', async () => {
      mockSend.mockResolvedValue(ok)
      const user = userEvent.setup()
      renderNotice()

      await user.click(screen.getByRole('button', RESEND))

      const sent = await screen.findByText('Sent. Check your inbox.')
      await waitFor(() => expect(document.activeElement).toContainElement(sent))
    })

    it('shows the rate-limit copy on a 429, not the server message', async () => {
      mockSend.mockResolvedValue(failed(429, undefined, 'Too many requests'))
      const user = userEvent.setup()
      renderNotice()

      await user.click(screen.getByRole('button', RESEND))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Too many attempts. Please try again in a few minutes.',
      )
      expect(screen.queryByText('Too many requests')).not.toBeInTheDocument()
    })

    it('says the address is already verified when it was verified elsewhere', async () => {
      mockSend.mockResolvedValue(failed(400, 'EMAIL_ALREADY_VERIFIED', 'Email is already verified'))
      const user = userEvent.setup()
      renderNotice()

      await user.click(screen.getByRole('button', RESEND))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Your email address is already verified. Reload the page.',
      )
    })

    it('shows the generic copy on any other failure', async () => {
      mockSend.mockResolvedValue(failed(500, undefined, 'Internal Server Error'))
      const user = userEvent.setup()
      renderNotice()

      await user.click(screen.getByRole('button', RESEND))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'The email was not sent. Try again.',
      )
      expect(screen.queryByText('Internal Server Error')).not.toBeInTheDocument()
      expect(screen.getByRole('button', RESEND)).toBeEnabled()
    })

    it('shows the generic copy when the request throws', async () => {
      mockSend.mockRejectedValue(new Error('fetch failed'))
      const user = userEvent.setup()
      renderNotice()

      await user.click(screen.getByRole('button', RESEND))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'The email was not sent. Try again.',
      )
    })

    it('disables the button while sending and returns focus to it after a failure', async () => {
      let settle: (value: SendResult) => void = () => {}
      mockSend.mockReturnValue(
        new Promise<SendResult>((resolve) => {
          settle = resolve
        }),
      )
      const user = userEvent.setup()
      renderNotice()

      await user.click(screen.getByRole('button', RESEND))
      const pending = await screen.findByRole('button', { name: 'Sending…' })
      expect(pending).toBeDisabled()
      dropFocusToBody()

      settle(failed(500))

      const button = await screen.findByRole('button', RESEND)
      await waitFor(() => expect(button).toHaveFocus())
    })
  })

  describe('once verified', () => {
    it('renders nothing without a landing', () => {
      const { container } = renderNotice({ emailVerified: true })

      expect(container).toBeEmptyDOMElement()
    })

    it('confirms once after the link landed here', () => {
      renderNotice({ emailVerified: true, landing: 'verified' })

      expect(screen.getByRole('status')).toHaveTextContent('Your email address is verified.')
      expect(screen.queryByRole('button', RESEND)).not.toBeInTheDocument()
    })

    it('renders nothing after a stale link error', () => {
      const { container } = renderNotice({ emailVerified: true, landing: 'expired' })

      expect(container).toBeEmptyDOMElement()
    })
  })

  describe('the URL', () => {
    it('clears the verification params and keeps the others', () => {
      window.history.replaceState(null, '', '/profile?verified=1&error=TOKEN_EXPIRED&tab=x#top')

      renderNotice({ landing: 'expired' })

      expect(window.location.pathname).toBe('/profile')
      expect(window.location.search).toBe('?tab=x')
      expect(window.location.hash).toBe('#top')
    })

    it('leaves the URL alone without a landing', () => {
      window.history.replaceState(null, '', '/profile?verified=1')

      renderNotice()

      expect(window.location.search).toBe('?verified=1')
    })
  })
})
