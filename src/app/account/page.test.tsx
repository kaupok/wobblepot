import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AccountProfilePage, { generateMetadata } from './page'
import AccountLayout from './layout'
import { accountSession as session, membershipWithMemberCount } from '@/test/account-page'

vi.mock('next-intl/server', async () => ({
  getTranslations: vi.fn((await import('@/test/account-page')).catalogTranslations),
}))

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

// The tab list is a client component with its own test.
vi.mock('./AccountTabs', () => ({
  AccountTabs: () => <nav aria-label="Account sections" />,
}))

// The two forms are client components with their own tests; the page owns
// what it hands them.
vi.mock('./ProfileNameForm', () => ({
  ProfileNameForm: ({ initialName }: { initialName: string }) => (
    <div data-testid="profile-name-form" data-initial-name={initialName} />
  ),
}))

vi.mock('./ChangePasswordForm', () => ({
  ChangePasswordForm: () => <div data-testid="change-password-form" />,
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

function props(searchParams: Record<string, string> = {}) {
  return { searchParams: Promise.resolve(searchParams) }
}

async function signedInWithHousehold() {
  const { getSession } = await import('@/lib/session')
  const { getHouseholdMembership } = await import('@/lib/household')
  vi.mocked(getSession).mockResolvedValue(session as never)
  vi.mocked(getHouseholdMembership).mockResolvedValue(membershipWithMemberCount(2) as never)
}

describe('AccountProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('names its tab in the document title', async () => {
    expect(await generateMetadata()).toEqual({ title: 'Profile · My account' })
  })

  it('hands the account name to the name form and renders the email', async () => {
    await signedInWithHousehold()

    render(await AccountProfilePage(props()))

    expect(screen.getByTestId('profile-name-form')).toHaveAttribute(
      'data-initial-name',
      'Test User',
    )
    expect(screen.getByText('test@example.com')).toBeInTheDocument()
  })

  // HON-1129: the password form sits in its own section, below the email.
  it('renders the change-password section after the email', async () => {
    await signedInWithHousehold()

    render(await AccountProfilePage(props()))

    const passwordHeading = screen.getByRole('heading', { name: 'Change password' })
    expect(screen.getByTestId('change-password-form')).toBeInTheDocument()
    expect(
      screen.getByText('test@example.com').compareDocumentPosition(passwordHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      screen.getByText('You stay signed in on this device. Other devices are signed out.'),
    ).toBeInTheDocument()
  })

  // HON-1229: the connections and the data have tabs of their own.
  it('shows nothing from the Connections or Your data tabs', async () => {
    await signedInWithHousehold()

    render(await AccountProfilePage(props()))

    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      'Change password',
    ])
  })

  it('starts the translations lookup without waiting for the membership query', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    const { getTranslations } = await import('next-intl/server')
    vi.mocked(getSession).mockResolvedValue(session as never)

    let resolveMembership: (value: unknown) => void = () => {}
    vi.mocked(getHouseholdMembership).mockReturnValue(
      new Promise((resolve) => {
        resolveMembership = resolve
      }) as never,
    )

    const pending = AccountProfilePage(props())
    await new Promise((resolve) => setTimeout(resolve, 0))

    // `getTranslations` is not DB-free — next-intl's request config resolves
    // `getLocale()`, which reads `household_member`. It must not sit behind the
    // membership query (HON-596 review).
    expect(getTranslations).toHaveBeenCalledWith('account')

    resolveMembership(membershipWithMemberCount(3))
    render(await pending)
    expect(screen.getByTestId('profile-name-form')).toBeInTheDocument()
  })

  /**
   * The layout's title sits on the page background as the document's `<h1>`,
   * at the Title level of the type scale (`variant="h4"`); the tab's sections
   * sit one level below it in the outline. See HON-619, HON-767 and HON-1229.
   *
   * The section level is derived from the title's tag rather than restated, so
   * moving the title moves what the loop demands — the same shape as
   * `MealForm.test.tsx` and `HouseholdSettingsForm.test.tsx`, deliberately, so
   * they do not diverge. The `level: 1` in the title query is the separate
   * assertion that the layout keeps its `<h1>`. The loop catches what axe's
   * `heading-order` cannot: that rule only flags increases greater than one, so
   * a `variant="section"` swap that forgets `as` would pass axe unnoticed.
   */
  it('renders each section one level below the layout title', async () => {
    await signedInWithHousehold()

    render(await AccountLayout({ children: await AccountProfilePage(props()) }))

    const title = screen.getByRole('heading', { name: 'My account', level: 1 })
    const titleLevel = Number(title.tagName.slice(1))

    expect(
      screen.getByRole('heading', { name: 'Change password', level: titleLevel + 1 }),
    ).toBeInTheDocument()
  })

  it('renders no page-level Card around the page (HON-767)', async () => {
    await signedInWithHousehold()

    const { container } = render(
      await AccountLayout({ children: await AccountProfilePage(props()) }),
    )

    expect(container.querySelector('[data-slot="card"]')).toBeNull()
  })

  it('redirects to sign-in when there is no session', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(null)

    await expect(AccountProfilePage(props())).rejects.toThrow('NEXT_REDIRECT:/sign-in')
    expect(getHouseholdMembership).not.toHaveBeenCalled()
  })

  it('redirects to onboarding when the user has no household', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(null)

    await expect(AccountProfilePage(props())).rejects.toThrow('NEXT_REDIRECT:/onboarding')
  })

  // A new user often opens the verification mail before onboarding is done;
  // the result goes along to /onboarding (HON-1155).
  it.each([
    [{ verified: '1' }, '/onboarding?verified=1'],
    [{ verified: '1', error: 'TOKEN_EXPIRED' }, '/onboarding?verified=1&error=TOKEN_EXPIRED'],
    [{ verified: '1', error: 'bogus' }, '/onboarding?verified=1&error=INVALID_TOKEN'],
  ])('forwards the verification result %o to onboarding', async (params, target) => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(null)

    await expect(AccountProfilePage(props(params))).rejects.toThrow(`NEXT_REDIRECT:${target}`)
  })

  // The verification link lands on `/account?verified=1`, with `&error=…` on a
  // failure (HON-1155). The page hands the notice the parsed result.
  it.each([
    [{}, 'null'],
    [{ verified: '1' }, 'verified'],
    [{ verified: '1', error: 'TOKEN_EXPIRED' }, 'expired'],
    [{ verified: '1', error: 'INVALID_TOKEN' }, 'invalid'],
  ])('hands the verification notice the state for %o', async (params, landing) => {
    await signedInWithHousehold()

    render(await AccountProfilePage(props(params)))

    const notice = screen.getByTestId('verify-email-notice')
    expect(notice).toHaveAttribute('data-email', 'test@example.com')
    expect(notice).toHaveAttribute('data-email-verified', 'false')
    expect(notice).toHaveAttribute('data-landing', landing)
  })
})
