import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authClient } from '@/lib/auth-client'
import { createQueryWrapper } from '@/test/query-wrapper'
import { dropFocusToBody } from '@/test/focus'
import type { ChangeEmailLanding } from '@/lib/email-verification'
import { ChangeEmailForm } from './ChangeEmailForm'

vi.mock('@/lib/auth-client', () => ({
  authClient: { changeEmail: vi.fn() },
}))

type ChangeResult = Awaited<ReturnType<typeof authClient.changeEmail>>

const ok = { data: { status: true }, error: null } as unknown as ChangeResult
function failed(status: number, message = 'Server said no') {
  return { data: null, error: { status, message } } as unknown as ChangeResult
}

const mockChange = vi.mocked(authClient.changeEmail)
const SUBMIT = { name: 'Change email' }

function renderForm(landing: ChangeEmailLanding | null = null) {
  return render(<ChangeEmailForm email="ann@example.com" landing={landing} />, {
    wrapper: createQueryWrapper().wrapper,
  })
}

async function submit(address: string) {
  const user = userEvent.setup()
  const field = screen.getByLabelText('Email')
  await user.clear(field)
  if (address) await user.type(field, address)
  await user.click(screen.getByRole('button', SUBMIT))
}

describe('ChangeEmailForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('shows the current address in the field', () => {
    renderForm()

    expect(screen.getByLabelText('Email')).toHaveValue('ann@example.com')
  })

  it('sends the link to the new address and keeps the current one on the page', async () => {
    mockChange.mockResolvedValue(ok)
    renderForm()

    await submit('  Ann.New@Example.com ')

    expect(mockChange).toHaveBeenCalledTimes(1)
    expect(mockChange).toHaveBeenCalledWith({
      newEmail: 'ann.new@example.com',
      callbackURL: '/account?emailChanged=1',
    })
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Check ann.new@example.com for a link. Your email changes when you open it.',
    )
    expect(screen.getByLabelText('Email')).toHaveValue('ann@example.com')
  })

  it.each([
    ['', 'Enter an email address.'],
    ['not-an-address', 'Enter a valid email address.'],
    ['ANN@example.com', 'This is your current email address.'],
  ])('shows catalog copy for %j and makes no request', async (address, message) => {
    renderForm()

    await submit(address)

    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
    expect(mockChange).not.toHaveBeenCalled()
  })

  it('shows the rate-limit copy on a 429, not the server text', async () => {
    mockChange.mockResolvedValue(failed(429, 'Too many requests'))
    renderForm()

    await submit('new@example.com')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Please try again in a few minutes.',
    )
    expect(screen.queryByText('Too many requests')).not.toBeInTheDocument()
  })

  it('shows the send-failed copy on any other error, not the server text', async () => {
    mockChange.mockResolvedValue(failed(500))
    renderForm()

    await submit('new@example.com')

    expect(await screen.findByRole('alert')).toHaveTextContent('The link was not sent. Try again.')
    expect(screen.queryByText('Server said no')).not.toBeInTheDocument()
  })

  it.each([
    ['changed', 'Your email address is now ann@example.com.'],
    [
      'expired',
      'This link has expired or was already used. Enter the new address again to get a new link.',
    ],
    ['invalid', 'This link does not work. Enter the new address again to get a new link.'],
  ] as const)('shows the %s landing once and clears its params', (landing, message) => {
    window.history.replaceState(null, '', '/account?emailChanged=1&error=X')

    renderForm(landing)

    expect(screen.getByRole('status')).toHaveTextContent(message)
    expect(window.location.search).toBe('')
  })

  it('hides the landing message once another request starts', async () => {
    mockChange.mockResolvedValue(ok)
    renderForm('expired')

    await submit('new@example.com')

    expect(await screen.findByRole('status')).toHaveTextContent('Check new@example.com')
    expect(screen.queryByText(/expired/)).not.toBeInTheDocument()
  })

  // Chromium drops focus to <body> when the focused control is disabled.
  it.each([
    ['a failure', failed(500)],
    ['a success', ok],
  ])(
    'disables the form while sending and returns focus to the button after %s',
    async (_l, result) => {
      let settle!: (result: ChangeResult) => void
      mockChange.mockImplementation(
        () => new Promise<ChangeResult>((resolve) => (settle = resolve)) as never,
      )
      renderForm()

      await submit('new@example.com')
      expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
      expect(screen.getByLabelText('Email')).toBeDisabled()
      dropFocusToBody()

      await act(async () => settle(result))

      await vi.waitFor(() => {
        expect(screen.getByRole('button', SUBMIT)).toHaveFocus()
      })
    },
  )
})
