import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import OnboardingPage from './page'

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

// Client components with their own tests; the page owns what it hands them.
vi.mock('./OnboardingFlow', () => ({
  OnboardingFlow: ({ userName }: { userName: string }) => (
    <div data-testid="onboarding-flow" data-user-name={userName} />
  ),
}))

vi.mock('@/components/VerifyEmailNotice', () => ({
  VerifyEmailNotice: ({
    email,
    emailVerified,
    landing,
  }: {
    email: string
    emailVerified: boolean
    landing: string | null
  }) => (
    <div
      data-testid="verify-email-notice"
      data-email={email}
      data-email-verified={String(emailVerified)}
      data-landing={String(landing)}
    />
  ),
}))

const session = {
  session: { id: 's1', userId: 'u1' },
  user: { id: 'u1', email: 'new@example.com', name: 'New User', emailVerified: true },
}

function props(searchParams: Record<string, string> = {}) {
  return { searchParams: Promise.resolve(searchParams) }
}

describe('OnboardingPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { auth } = await import('@/lib/auth')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(auth.api.getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(null)
  })

  it('renders the flow without a verification notice', async () => {
    render(await OnboardingPage(props()))

    expect(screen.getByTestId('onboarding-flow')).toHaveAttribute('data-user-name', 'New User')
    expect(screen.queryByTestId('verify-email-notice')).not.toBeInTheDocument()
  })

  // `/account` forwards the link's result here for a user without a
  // household (HON-1155).
  it.each([
    [{ verified: '1' }, 'verified'],
    [{ verified: '1', error: 'TOKEN_EXPIRED' }, 'expired'],
    [{ verified: '1', error: 'INVALID_TOKEN' }, 'invalid'],
  ])('shows the verification notice for %o', async (params, landing) => {
    render(await OnboardingPage(props(params)))

    const notice = screen.getByTestId('verify-email-notice')
    expect(notice).toHaveAttribute('data-email', 'new@example.com')
    expect(notice).toHaveAttribute('data-email-verified', 'true')
    expect(notice).toHaveAttribute('data-landing', landing)
    expect(screen.getByTestId('onboarding-flow')).toBeInTheDocument()
  })

  it('sends a user with a household home', async () => {
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getHouseholdMembership).mockResolvedValue({ id: 'm1' } as never)

    await expect(OnboardingPage(props({ verified: '1' }))).rejects.toThrow('NEXT_REDIRECT:/')
  })

  it('sends an anonymous visitor to sign in', async () => {
    const { auth } = await import('@/lib/auth')
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never)

    await expect(OnboardingPage(props())).rejects.toThrow(
      'NEXT_REDIRECT:/sign-in?returnUrl=/onboarding',
    )
  })
})
