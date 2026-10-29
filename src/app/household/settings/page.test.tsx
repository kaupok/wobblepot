import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { accountSession as session, membershipWithMemberCount } from '@/test/account-page'

import enMessages from '../../../../messages/en.json'
import HouseholdLayout from '../layout'
import HouseholdSettingsPage, { generateMetadata } from './page'

vi.mock('next-intl/server', async () => ({
  getTranslations: vi.fn((await import('@/test/account-page')).catalogTranslations),
}))

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
  countAccountHoldingMembers: vi.fn(async () => 1),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock('../HouseholdTabs', () => ({
  HouseholdTabs: () => <nav aria-label="Household sections" />,
}))

// A client component with a mutation. Surface the props the page hands it;
// `HouseholdDetailsForm.test.tsx` covers the form itself.
vi.mock('./HouseholdDetailsForm', () => ({
  HouseholdDetailsForm: ({
    household,
    isOwner,
  }: {
    household: { name: string; locale: string }
    isOwner: boolean
  }) => (
    <h2
      data-testid="details-form"
      data-name={household.name}
      data-locale={household.locale}
      data-owner={String(isOwner)}
    >
      Household details
    </h2>
  ),
}))

// Its own behaviour is in `LeaveHouseholdDialog.test.tsx`; the page passes it
// the inputs that decide whether the user can leave (HON-1133).
vi.mock('./LeaveHouseholdDialog', () => ({
  LeaveHouseholdDialog: (props: { isOwner: boolean; accountMemberCount: number }) => (
    <div
      data-testid="leave-household"
      data-owner={String(props.isOwner)}
      data-account-count={String(props.accountMemberCount)}
    />
  ),
}))

async function mockSignedIn(role: 'owner' | 'member' = 'owner') {
  const { getSession } = await import('@/lib/session')
  const { getHouseholdMembership } = await import('@/lib/household')
  vi.mocked(getSession).mockResolvedValue(session as never)
  vi.mocked(getHouseholdMembership).mockResolvedValue(membershipWithMemberCount(2, role) as never)
}

describe('HouseholdSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('names its tab in the document title', async () => {
    expect(await generateMetadata()).toEqual({ title: 'Settings · Household' })
  })

  it('renders Household details, then Leave household, one level below the layout title', async () => {
    await mockSignedIn()

    render(await HouseholdLayout({ children: await HouseholdSettingsPage() }))

    const title = screen.getByRole('heading', { name: 'Household', level: 1 })
    const level = Number(title.tagName.slice(1)) + 1
    expect(screen.getAllByRole('heading', { level }).map((h) => h.textContent)).toEqual([
      'Household details',
      'Leave household',
    ])
  })

  it('hands the form the household name and its resolved locale', async () => {
    await mockSignedIn()

    render(await HouseholdSettingsPage())

    const form = screen.getByTestId('details-form')
    expect(form).toHaveAttribute('data-name', 'Doe Family')
    expect(form).toHaveAttribute('data-locale', 'en')
    expect(form).toHaveAttribute('data-owner', 'true')
  })

  it('ends with the Leave household section, after the details form', async () => {
    await mockSignedIn('member')

    render(await HouseholdSettingsPage())

    const form = screen.getByTestId('details-form')
    const leave = screen.getByTestId('leave-household')
    expect(form.compareDocumentPosition(leave) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(leave).toHaveAttribute('data-owner', 'false')
  })

  it("passes an owner's account-holder count to the leave section", async () => {
    await mockSignedIn('owner')
    const { countAccountHoldingMembers } = await import('@/lib/household')
    vi.mocked(countAccountHoldingMembers).mockResolvedValueOnce(3)

    render(await HouseholdSettingsPage())

    expect(countAccountHoldingMembers).toHaveBeenCalledWith('household-123')
    expect(screen.getByTestId('leave-household')).toHaveAttribute('data-account-count', '3')
  })

  it("does not count a member's household's account holders", async () => {
    await mockSignedIn('member')
    const { countAccountHoldingMembers } = await import('@/lib/household')

    render(await HouseholdSettingsPage())

    expect(countAccountHoldingMembers).not.toHaveBeenCalled()
  })

  it('shows a member the owner-only notice once, above the form, read-only', async () => {
    await mockSignedIn('member')

    render(await HouseholdSettingsPage())

    // getByText throws on more than one match, so this also asserts "once".
    const notice = screen.getByText(enMessages.household.settings.ownerOnlyNotice)
    expect(notice.nextElementSibling).toBe(screen.getByTestId('details-form'))
    expect(screen.getByTestId('details-form')).toHaveAttribute('data-owner', 'false')
  })

  it('shows the owner no owner-only notice', async () => {
    await mockSignedIn()

    render(await HouseholdSettingsPage())

    expect(
      screen.queryByText(enMessages.household.settings.ownerOnlyNotice),
    ).not.toBeInTheDocument()
  })

  it('redirects to sign-in when there is no session', async () => {
    const { getSession } = await import('@/lib/session')
    vi.mocked(getSession).mockResolvedValue(null)

    await expect(HouseholdSettingsPage()).rejects.toThrow(/^NEXT_REDIRECT:\/sign-in$/)
  })

  it('redirects home when the user has no household', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(null)

    await expect(HouseholdSettingsPage()).rejects.toThrow(/^NEXT_REDIRECT:\/$/)
  })
})
