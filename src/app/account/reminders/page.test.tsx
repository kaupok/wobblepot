import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { accountSession as session, membershipWithMemberCount } from '@/test/account-page'

import AccountLayout from '../layout'
import AccountRemindersPage, { generateMetadata } from './page'

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

vi.mock('../AccountTabs', () => ({
  AccountTabs: () => <nav aria-label="Account sections" />,
}))

// The form is a client component with a mutation. Surface the props the page
// hands it; `WeeklyReminderForm.test.tsx` covers the form itself.
vi.mock('./WeeklyReminderForm', () => ({
  WeeklyReminderForm: ({
    weekday,
    confirmed,
    confirmLinkSent,
  }: {
    weekday: number | null
    confirmed: boolean
    confirmLinkSent: boolean
  }) => (
    <h2
      data-testid="reminder-form"
      data-weekday={String(weekday)}
      data-confirmed={String(confirmed)}
      data-confirm-link-sent={String(confirmLinkSent)}
    >
      Weekly reminder
    </h2>
  ),
}))

async function signedIn(
  reminder: {
    reminderWeekday: number | null
    reminderConfirmedAt: Date | null
    reminderConfirmToken?: string | null
  },
  role: 'owner' | 'member' = 'owner',
) {
  const { getSession } = await import('@/lib/session')
  const { getHouseholdMembership } = await import('@/lib/household')
  vi.mocked(getSession).mockResolvedValue(session as never)
  vi.mocked(getHouseholdMembership).mockResolvedValue({
    ...membershipWithMemberCount(2, role),
    ...reminder,
  } as never)
}

describe('AccountRemindersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('names its tab in the document title', async () => {
    expect(await generateMetadata()).toEqual({ title: 'Reminders · My account' })
  })

  it.each(['owner', 'member'] as const)(
    "hands a %s's own weekday and confirmation to the form",
    async (role) => {
      await signedIn({ reminderWeekday: 3, reminderConfirmedAt: new Date('2026-10-01') }, role)

      render(await AccountRemindersPage())

      const form = screen.getByTestId('reminder-form')
      expect(form).toHaveAttribute('data-weekday', '3')
      expect(form).toHaveAttribute('data-confirmed', 'true')
    },
  )

  it('reads an unconfirmed reminder as not confirmed', async () => {
    await signedIn({ reminderWeekday: 7, reminderConfirmedAt: null })

    render(await AccountRemindersPage())

    expect(screen.getByTestId('reminder-form')).toHaveAttribute('data-confirmed', 'false')
  })

  // HON-1137: an account email change clears the confirmation and its token.
  it.each([
    ['confirm-token', 'true'],
    [null, 'false'],
  ])('reads a confirm token of %s as a link sent: %s', async (token, sent) => {
    await signedIn({ reminderWeekday: 7, reminderConfirmedAt: null, reminderConfirmToken: token })

    render(await AccountRemindersPage())

    expect(screen.getByTestId('reminder-form')).toHaveAttribute('data-confirm-link-sent', sent)
  })

  it.each([null, 0, 9])('reads a stored weekday of %s as off', async (stored) => {
    await signedIn({ reminderWeekday: stored, reminderConfirmedAt: null })

    render(await AccountRemindersPage())

    expect(screen.getByTestId('reminder-form')).toHaveAttribute('data-weekday', 'null')
  })

  it('renders the section one level below the layout title', async () => {
    await signedIn({ reminderWeekday: null, reminderConfirmedAt: null })

    render(await AccountLayout({ children: await AccountRemindersPage() }))

    const title = screen.getByRole('heading', { name: 'My account', level: 1 })
    expect(
      screen.getByRole('heading', {
        name: 'Weekly reminder',
        level: Number(title.tagName.slice(1)) + 1,
      }),
    ).toBeInTheDocument()
  })

  it('redirects to sign-in when there is no session', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(null)

    await expect(AccountRemindersPage()).rejects.toThrow('NEXT_REDIRECT:/sign-in')
    expect(getHouseholdMembership).not.toHaveBeenCalled()
  })

  it('redirects to onboarding when the user has no household', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(null)

    await expect(AccountRemindersPage()).rejects.toThrow('NEXT_REDIRECT:/onboarding')
  })
})
