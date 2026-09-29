/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
// `t.rich` (consent-checkbox label) returns React elements, which the default
// vitest next-intl mock (a plain string-resolver) cannot handle. Use the real
// provider so the `<terms>`/`<privacy>` markup actually renders anchors.
vi.unmock('next-intl')
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../messages/en.json'
import { SignUpForm } from './SignUpForm'

// Mock Next.js navigation
const mockPush = vi.fn()
const mockRefresh = vi.fn()
const mockGet = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
  useSearchParams: () => ({
    get: mockGet,
  }),
}))

// Mock auth client
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    signUp: {
      email: vi.fn(),
    },
  },
}))

// Mock the friendly-error hook so tests assert on raw server messages without
// coupling to the localized catalog copy. Catalog → key mapping is exercised
// in src/lib/auth-errors.test.ts.
vi.mock('@/lib/auth-errors-client', () => ({
  useAuthErrorMessage: () => (msg: string) => msg,
}))

const FORM_PROPS = {
  inviteRequired: false,
  inviteCodeLabel: 'Invite code',
  inviteCodeHint: 'Paste the code from your invitation.',
} as const

function renderForm(props: Partial<React.ComponentProps<typeof SignUpForm>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SignUpForm {...FORM_PROPS} {...props} />
    </NextIntlClientProvider>,
  )
}

const consentCheckbox = () => screen.getByRole('checkbox', { name: /terms of service/i })

/** Fill the always-required fields and tick the consent checkbox. */
async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/name/i), 'Test User')
  await user.type(screen.getByLabelText(/email/i), 'test@example.com')
  await user.type(screen.getByLabelText('Password'), 'password123')
  await user.click(consentCheckbox())
}

describe('SignUpForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockReturnValue(null)
  })

  describe('rendering (open sign-up — flag off)', () => {
    it('renders sign up form with heading', () => {
      renderForm()

      expect(screen.getByRole('heading', { level: 1, name: /sign up/i })).toBeInTheDocument()
    })

    it('renders name input with label', () => {
      renderForm()

      const input = screen.getByLabelText(/name/i)
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('type', 'text')
    })

    it('renders email input with label', () => {
      renderForm()

      const input = screen.getByLabelText(/email/i)
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('type', 'email')
    })

    it('renders password input with label', () => {
      renderForm()

      const input = screen.getByLabelText('Password')
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('type', 'password')
    })

    // `new-password` is what makes a password manager offer to generate and save one; WCAG 1.3.5.
    it('declares the autofill purpose of each field', () => {
      renderForm()

      const name = screen.getByLabelText(/name/i)
      expect(name).toHaveAttribute('name', 'name')
      expect(name).toHaveAttribute('autocomplete', 'name')

      const email = screen.getByLabelText(/email/i)
      expect(email).toHaveAttribute('name', 'email')
      expect(email).toHaveAttribute('autocomplete', 'email')

      const password = screen.getByLabelText('Password')
      expect(password).toHaveAttribute('name', 'password')
      expect(password).toHaveAttribute('autocomplete', 'new-password')
    })

    it('renders sign up button', () => {
      renderForm()

      expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument()
    })

    it('renders sign in link without returnUrl by default', () => {
      renderForm()

      const link = screen.getByRole('link', { name: /sign in/i })
      expect(link).toHaveAttribute('href', '/sign-in')
    })

    it('displays description text', () => {
      renderForm()

      expect(screen.getByText(/create a new account to get started/i)).toBeInTheDocument()
    })

    it('does not render the private-beta banner or invite-code field', () => {
      renderForm()

      expect(screen.queryByLabelText(/invite code/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/private beta/i)).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Ask for an invite' })).not.toBeInTheDocument()
    })
  })

  describe('rendering (invite-only — flag on)', () => {
    it('renders the private-beta banner when inviteRequired is true', () => {
      renderForm({ inviteRequired: true })
      expect(screen.getByText(/private beta — sign-up is by invite code only/i)).toBeInTheDocument()
    })

    it('ends the banner with a link to ask support for an invite (HON-847)', () => {
      renderForm({ inviteRequired: true })

      const notice = screen.getByRole('note', { name: 'Private beta notice' })
      expect(notice).toHaveTextContent(
        "Private beta — sign-up is by invite code only. Don't have one? Ask for an invite at support@wobblepot.com.",
      )
      expect(within(notice).getByRole('link', { name: 'Ask for an invite' })).toHaveAttribute(
        'href',
        'mailto:support@wobblepot.com?subject=Invite%20request',
      )
    })

    it('renders the invite-code input when inviteRequired is true', () => {
      renderForm({ inviteRequired: true })

      const input = screen.getByLabelText('Invite code')
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('type', 'text')
      expect(input).toBeRequired()
      expect(input).toHaveAttribute('name', 'inviteCode')
      expect(input).toHaveAttribute('autocomplete', 'off')
    })
  })

  describe('terms consent (HON-457)', () => {
    it('renders the consent checkbox unchecked with links to terms and privacy', () => {
      renderForm()

      const checkbox = consentCheckbox()
      expect(checkbox).toBeInTheDocument()
      expect(checkbox).not.toBeChecked()

      const termsLink = screen.getByRole('link', { name: /terms of service/i })
      expect(termsLink).toHaveAttribute('href', '/terms')
      expect(termsLink).toHaveAttribute('target', '_blank')

      const privacyLink = screen.getByRole('link', { name: /privacy policy/i })
      expect(privacyLink).toHaveAttribute('href', '/privacy')
      expect(privacyLink).toHaveAttribute('target', '_blank')
    })

    it('keeps submit enabled while the checkbox is unticked (HON-848)', () => {
      renderForm()

      expect(screen.getByRole('button', { name: /sign up/i })).toBeEnabled()
      expect(consentCheckbox()).toHaveAttribute('aria-required', 'true')
    })

    it('submitting unticked shows the consent error, focuses the checkbox and never calls the API (HON-848)', async () => {
      const { authClient } = await import('@/lib/auth-client')
      const user = userEvent.setup({ delay: null })
      renderForm()

      await user.type(screen.getByLabelText(/name/i), 'Test User')
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent(
        'To create an account, accept the terms of service and privacy policy.',
      )
      expect(alert).toHaveAttribute('id', 'consent-error')

      const checkbox = consentCheckbox()
      expect(checkbox).toHaveFocus()
      expect(checkbox).toHaveAttribute('aria-invalid', 'true')
      expect(checkbox).toHaveAttribute('aria-describedby', 'consent-error')
      expect(authClient.signUp.email).not.toHaveBeenCalled()
    })

    it('ticking the checkbox clears the consent error (HON-848)', async () => {
      const user = userEvent.setup({ delay: null })
      renderForm()

      await user.type(screen.getByLabelText(/name/i), 'Test User')
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.click(screen.getByRole('button', { name: /sign up/i }))
      expect(screen.getByRole('alert')).toBeInTheDocument()

      await user.click(consentCheckbox())

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(consentCheckbox()).toHaveAttribute('aria-invalid', 'false')
      expect(consentCheckbox()).not.toHaveAttribute('aria-describedby')
    })

    it('includes acceptedTerms: true in the payload when checked', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signUp.email).mockImplementation(async (creds, options) => {
        if (options?.onSuccess) {
          options.onSuccess({} as any)
        }
      })

      const user = userEvent.setup({ delay: null })
      renderForm()

      await fillRequiredFields(user)
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await vi.waitFor(() => {
        expect(authClient.signUp.email).toHaveBeenCalledWith(
          expect.objectContaining({ acceptedTerms: true }),
          expect.any(Object),
        )
      })
    })
  })

  describe('returnUrl functionality', () => {
    it('sign-in link includes returnUrl when present', () => {
      mockGet.mockReturnValue('/household')

      renderForm()

      const link = screen.getByRole('link', { name: /sign in/i })
      expect(link).toHaveAttribute('href', '/sign-in?returnUrl=%2Fhousehold')
    })

    it('sign-in link is plain /sign-in when returnUrl is default /', () => {
      mockGet.mockReturnValue('/')

      renderForm()

      const link = screen.getByRole('link', { name: /sign in/i })
      expect(link).toHaveAttribute('href', '/sign-in')
    })

    it('navigates to default / on successful sign up without returnUrl', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signUp.email).mockImplementation(async (creds, options) => {
        if (options?.onSuccess) {
          options.onSuccess({} as any)
        }
      })

      const user = userEvent.setup({ delay: null })
      renderForm()

      await fillRequiredFields(user)
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await vi.waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/')
      })
      // The request promise resolves before router.push has rendered the new
      // route, so the form must stay disabled until it unmounts rather than
      // flicker back to "Sign up" for a beat.
      expect(screen.getByRole('button', { name: /creating account/i })).toBeDisabled()
      expect(screen.getByLabelText(/email/i)).toBeDisabled()
    })

    it('navigates to returnUrl on successful sign up when provided', async () => {
      mockGet.mockReturnValue('/household/household')

      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signUp.email).mockImplementation(async (creds, options) => {
        if (options?.onSuccess) {
          options.onSuccess({} as any)
        }
      })

      const user = userEvent.setup({ delay: null })
      renderForm()

      await fillRequiredFields(user)
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await vi.waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/household/household')
      })
    })

    it('calls router.refresh after navigation', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signUp.email).mockImplementation(async (creds, options) => {
        if (options?.onSuccess) {
          options.onSuccess({} as any)
        }
      })

      const user = userEvent.setup({ delay: null })
      renderForm()

      await fillRequiredFields(user)
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await vi.waitFor(() => {
        expect(mockRefresh).toHaveBeenCalled()
      })
    })
  })

  describe('form submission', () => {
    it('calls authClient.signUp.email with the basic fields when invite gate is off', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signUp.email).mockImplementation(async (creds, options) => {
        if (options?.onSuccess) {
          options.onSuccess({} as any)
        }
      })

      const user = userEvent.setup({ delay: null })
      renderForm()

      await fillRequiredFields(user)
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await vi.waitFor(() => {
        expect(authClient.signUp.email).toHaveBeenCalledWith(
          {
            email: 'test@example.com',
            password: 'password123',
            name: 'Test User',
            acceptedTerms: true,
          },
          {
            onSuccess: expect.any(Function),
            onError: expect.any(Function),
          },
        )
      })
    })

    it('passes inviteCode in the payload when invite gate is on', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signUp.email).mockImplementation(async (creds, options) => {
        if (options?.onSuccess) {
          options.onSuccess({} as any)
        }
      })

      const user = userEvent.setup({ delay: null })
      renderForm({ inviteRequired: true })

      await fillRequiredFields(user)
      await user.type(screen.getByLabelText('Invite code'), 'beta-001')
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await vi.waitFor(() => {
        expect(authClient.signUp.email).toHaveBeenCalledWith(
          {
            email: 'test@example.com',
            password: 'password123',
            name: 'Test User',
            acceptedTerms: true,
            inviteCode: 'beta-001',
          },
          expect.any(Object),
        )
      })
    })

    it('shows error message on sign up failure', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signUp.email).mockImplementation(async (creds, options) => {
        if (options?.onError) {
          options.onError({
            error: {
              message: 'Email already exists',
              status: 400,
              statusText: 'Bad Request',
              name: 'AuthError',
            },
          } as any)
        }
      })

      const user = userEvent.setup({ delay: null })
      renderForm()

      await user.type(screen.getByLabelText(/name/i), 'Test User')
      await user.type(screen.getByLabelText(/email/i), 'existing@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.click(consentCheckbox())
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/email already exists/i)
      })
    })
  })
})
