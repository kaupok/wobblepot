import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import HouseholdMealPreferencesPage, { generateMetadata } from './page'
import HouseholdLayout from '../layout'
import { accountSession as session, membershipWithMemberCount } from '@/test/account-page'
import enMessages from '../../../../messages/en.json'

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

vi.mock('../HouseholdTabs', () => ({
  HouseholdTabs: () => <nav aria-label="Household sections" />,
}))

type FormProps = { preferences: unknown; isOwner: boolean }

// Both forms are client components with mutations. Surface the props the page
// hands them; their colocated tests cover the forms themselves.
vi.mock('./FoodPreferencesForm', () => ({
  FoodPreferencesForm: ({ preferences, isOwner }: FormProps) => (
    <h2
      data-testid="food-form"
      data-preferences={JSON.stringify(preferences)}
      data-owner={String(isOwner)}
    >
      Food preferences
    </h2>
  ),
}))

vi.mock('./MealsToPlanForm', () => ({
  MealsToPlanForm: ({ preferences, isOwner }: FormProps) => (
    <h2
      data-testid="meals-form"
      data-preferences={JSON.stringify(preferences)}
      data-owner={String(isOwner)}
    >
      Meals to plan
    </h2>
  ),
}))

const storedPreferences = {
  id: 'prefs-1',
  householdId: 'household-123',
  dietaryType: 'vegan',
  allergensToAvoid: ['nuts'],
  restrictions: ['halal'],
  excludedIngredients: ['cilantro'],
  weekdayMealTypes: ['dinner'],
  weekendMealTypes: ['lunch', 'dinner'],
}

async function mockSignedIn(
  role: 'owner' | 'member' = 'owner',
  preferences: typeof storedPreferences | null = null,
) {
  const { getSession } = await import('@/lib/session')
  const { getHouseholdMembership } = await import('@/lib/household')
  const membership = membershipWithMemberCount(2, role)
  vi.mocked(getSession).mockResolvedValue(session as never)
  vi.mocked(getHouseholdMembership).mockResolvedValue({
    ...membership,
    household: { ...membership.household, preferences },
  } as never)
}

describe('HouseholdMealPreferencesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('names its tab in the document title', async () => {
    expect(await generateMetadata()).toEqual({ title: 'Meal preferences · Household' })
  })

  it('renders Food preferences, then Meals to plan, one level below the layout title', async () => {
    await mockSignedIn()

    render(await HouseholdLayout({ children: await HouseholdMealPreferencesPage() }))

    const title = screen.getByRole('heading', { name: 'Household', level: 1 })
    const level = Number(title.tagName.slice(1)) + 1
    expect(screen.getAllByRole('heading', { level }).map((h) => h.textContent)).toEqual([
      'Food preferences',
      'Meals to plan',
    ])
  })

  it('hands both forms the stored preferences, without the row ids', async () => {
    await mockSignedIn('owner', storedPreferences)

    render(await HouseholdMealPreferencesPage())

    const expected = {
      dietaryType: 'vegan',
      allergensToAvoid: ['nuts'],
      restrictions: ['halal'],
      excludedIngredients: ['cilantro'],
      weekdayMealTypes: ['dinner'],
      weekendMealTypes: ['lunch', 'dinner'],
    }
    for (const id of ['food-form', 'meals-form']) {
      expect(JSON.parse(screen.getByTestId(id).dataset.preferences!)).toEqual(expected)
      expect(screen.getByTestId(id)).toHaveAttribute('data-owner', 'true')
    }
  })

  it('hands both forms null when the household has no preferences row', async () => {
    await mockSignedIn()

    render(await HouseholdMealPreferencesPage())

    expect(screen.getByTestId('food-form')).toHaveAttribute('data-preferences', 'null')
    expect(screen.getByTestId('meals-form')).toHaveAttribute('data-preferences', 'null')
  })

  it('shows a member the owner-only notice once, above the forms, read-only', async () => {
    await mockSignedIn('member')

    render(await HouseholdMealPreferencesPage())

    // getByText throws on more than one match, so this also asserts "once".
    const notice = screen.getByText(enMessages.household.settings.ownerOnlyNotice)
    expect(notice.nextElementSibling).toBe(screen.getByTestId('food-form'))
    expect(screen.getByTestId('food-form')).toHaveAttribute('data-owner', 'false')
    expect(screen.getByTestId('meals-form')).toHaveAttribute('data-owner', 'false')
  })

  it('shows the owner no owner-only notice', async () => {
    await mockSignedIn()

    render(await HouseholdMealPreferencesPage())

    expect(
      screen.queryByText(enMessages.household.settings.ownerOnlyNotice),
    ).not.toBeInTheDocument()
  })

  it('redirects to sign-in when there is no session', async () => {
    const { getSession } = await import('@/lib/session')
    vi.mocked(getSession).mockResolvedValue(null)

    await expect(HouseholdMealPreferencesPage()).rejects.toThrow(/^NEXT_REDIRECT:\/sign-in$/)
  })

  it('redirects home when the user has no household', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(null)

    await expect(HouseholdMealPreferencesPage()).rejects.toThrow(/^NEXT_REDIRECT:\/$/)
  })
})
