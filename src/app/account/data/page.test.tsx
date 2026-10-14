import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AccountDataPage, { generateMetadata } from './page'
import AccountLayout from '../layout'
import { accountSession as session, membershipWithMemberCount } from '@/test/account-page'

vi.mock('next-intl/server', async () => ({
  getTranslations: vi.fn((await import('@/test/account-page')).catalogTranslations),
}))

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
  countAccountHoldingMembers: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock('../AccountTabs', () => ({
  AccountTabs: () => <nav aria-label="Account sections" />,
}))

// The dialog is a client component with Radix internals. Surface the props the
// page hands it as data attributes — `accountMemberCount` counts only members
// with an account, not the household size on `_count.members` (HON-881).
vi.mock('./DeleteAccountDialog', () => ({
  DeleteAccountDialog: ({
    userEmail,
    householdName,
    isOwner,
    accountMemberCount,
  }: {
    userEmail: string
    householdName?: string
    isOwner?: boolean
    accountMemberCount?: number
  }) => (
    <div
      data-testid="delete-account-dialog"
      data-user-email={userEmail}
      data-household-name={householdName}
      data-is-owner={String(isOwner)}
      data-account-member-count={String(accountMemberCount)}
    />
  ),
}))

async function signedIn(membership: unknown) {
  const { getSession } = await import('@/lib/session')
  const { getHouseholdMembership } = await import('@/lib/household')
  vi.mocked(getSession).mockResolvedValue(session as never)
  vi.mocked(getHouseholdMembership).mockResolvedValue(membership as never)
}

describe('AccountDataPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { countAccountHoldingMembers } = await import('@/lib/household')
    vi.mocked(countAccountHoldingMembers).mockResolvedValue(1)
  })

  it('names its tab in the document title', async () => {
    expect(await generateMetadata()).toEqual({ title: 'Your data · My account' })
  })

  // An owner whose household has four member rows, only two of them with an
  // account: the other two are children added by name. The dialog must get
  // the account-holding count, the one the route's guard uses, or it would
  // block a deletion the route allows (HON-881).
  it("passes the account-holding member count to an owner's delete dialog", async () => {
    const { getHouseholdMembership, countAccountHoldingMembers } = await import('@/lib/household')
    await signedIn(membershipWithMemberCount(4))
    vi.mocked(countAccountHoldingMembers).mockResolvedValue(2)

    render(await AccountDataPage())

    const dialog = screen.getByTestId('delete-account-dialog')
    expect(dialog).toHaveAttribute('data-account-member-count', '2')
    expect(dialog).toHaveAttribute('data-household-name', 'Doe Family')
    expect(dialog).toHaveAttribute('data-is-owner', 'true')
    expect(dialog).toHaveAttribute('data-user-email', 'test@example.com')
    expect(countAccountHoldingMembers).toHaveBeenCalledWith('household-123')
    expect(getHouseholdMembership).toHaveBeenCalledTimes(1)
  })

  it('marks a non-owner membership as such', async () => {
    const { countAccountHoldingMembers } = await import('@/lib/household')
    await signedIn(membershipWithMemberCount(1, 'member'))

    render(await AccountDataPage())

    const dialog = screen.getByTestId('delete-account-dialog')
    expect(dialog).toHaveAttribute('data-is-owner', 'false')
    // Only an owner's deletion turns on the count, so a member's page skips it.
    expect(dialog).toHaveAttribute('data-account-member-count', 'undefined')
    expect(countAccountHoldingMembers).not.toHaveBeenCalled()
  })

  it('offers the download, then the danger zone with the delete dialog', async () => {
    await signedIn(membershipWithMemberCount(2))

    render(await AccountDataPage())

    expect(screen.getByRole('link', { name: 'Download my data' })).toHaveAttribute(
      'href',
      '/api/auth/user/export',
    )
    // HON-1229: only this tab's sections, Your data above Danger zone.
    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      'Your data',
      'Danger zone',
    ])
    expect(
      screen
        .getByRole('heading', { name: 'Danger zone' })
        .compareDocumentPosition(screen.getByTestId('delete-account-dialog')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('renders each section one level below the layout title', async () => {
    await signedIn(membershipWithMemberCount(2))

    render(await AccountLayout({ children: await AccountDataPage() }))

    const title = screen.getByRole('heading', { name: 'My account', level: 1 })
    const titleLevel = Number(title.tagName.slice(1))

    for (const name of ['Your data', 'Danger zone']) {
      expect(screen.getByRole('heading', { name, level: titleLevel + 1 })).toBeInTheDocument()
    }
  })

  it('redirects to sign-in when there is no session', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(null)

    await expect(AccountDataPage()).rejects.toThrow('NEXT_REDIRECT:/sign-in')
    expect(getHouseholdMembership).not.toHaveBeenCalled()
  })

  it('redirects to onboarding when the user has no household', async () => {
    await signedIn(null)

    await expect(AccountDataPage()).rejects.toThrow('NEXT_REDIRECT:/onboarding')
  })
})
