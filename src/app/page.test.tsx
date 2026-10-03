import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Home from './page'
import enMessages from '../../messages/en.json'
import etMessages from '../../messages/et.json'
import { getServerFlag } from '@/lib/feature-flags'
import { loadDemoDay } from '@/lib/landing/load-demo-day'
import { createMeal } from '@/stories/fixtures'
import { createQueryWrapper } from '@/test/query-wrapper'
import type { MealType } from '@/generated/prisma/enums'

// Resolve `getTranslations(namespace)` through the real `createTranslator`, so
// the Server Component renders as if the i18n pipeline had configured a
// request — including `t.rich`, which the private-beta notice's link uses.
// `translationLocale` lets a test switch catalogs.
let translationLocale: 'en' | 'et' = 'en'
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await vi.importActual<typeof import('next-intl')>('next-intl')
  return {
    getTranslations: vi.fn(async (namespace: string) =>
      createTranslator({
        locale: translationLocale,
        messages: (translationLocale === 'et' ? etMessages : enMessages) as never,
        namespace: namespace as never,
      }),
    ),
  }
})

vi.mock('@/lib/feature-flags', () => ({
  getServerFlag: vi.fn(async () => true),
}))

// Mock the auth module to prevent database initialization
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

// Mock the household module
vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

// Mock Next.js headers
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    refresh: vi.fn(),
  })),
}))

// Mock the timeline components since they require complex client-side behavior
vi.mock('@/components/timeline', () => ({
  TimelineView: vi.fn(() => <div data-testid="timeline-view">Timeline</div>),
  FirstTimeSetup: vi.fn(() => <div data-testid="first-time-setup">First Time Setup</div>),
}))

// The page reads through the same loaders the API routes wrap (HON-789).
vi.mock('@/lib/meal-planning/load-plan-entries', () => ({ loadPlanEntries: vi.fn() }))
vi.mock('@/lib/meal-planning/load-pantry', () => ({ loadPantry: vi.fn() }))
vi.mock('@/lib/shopping/load-shopping-list', () => ({ loadShoppingList: vi.fn() }))
vi.mock('@/lib/landing/load-demo-day', () => ({
  DEMO_TIMEZONE: 'Europe/Tallinn',
  loadDemoDay: vi.fn(async () => null),
}))
vi.mock('@/lib/i18n/get-locale', () => ({
  getLocale: vi.fn(async () => translationLocale),
}))

// Nothing on this page may call back into our own API over HTTP (HON-789).
const mockFetch = vi.fn()
global.fetch = mockFetch

const PLANNED_ENTRY = {
  id: 'entry-1',
  date: '2026-03-29',
  mealType: 'dinner',
  status: 'planned',
  rating: null,
  meal: { id: 'meal-1', name: 'Chicken Rice', components: [], nutrition: {} },
  preparationTips: null,
  note: null,
  servingOverride: null,
  pantryDeducted: false,
}

const EMPTY_SHOPPING_LIST = {
  windowDays: 7,
  startDate: '2026-03-29',
  endDate: '2026-04-05',
  generatedAt: null,
  hasAnyPlan: true,
  groups: [],
  customItems: [],
  summary: { totalItems: 0, purchasedItems: 0, remainingItems: 0 },
}

async function mockLoaders({
  entries = { entries: [], planId: null },
  pantry = { items: [], windowDays: null },
  shoppingList = EMPTY_SHOPPING_LIST,
}: {
  entries?: unknown
  pantry?: unknown
  shoppingList?: unknown
} = {}) {
  const { loadPlanEntries } = await import('@/lib/meal-planning/load-plan-entries')
  const { loadPantry } = await import('@/lib/meal-planning/load-pantry')
  const { loadShoppingList } = await import('@/lib/shopping/load-shopping-list')
  vi.mocked(loadPlanEntries).mockImplementation(async () => {
    if (entries instanceof Error) throw entries
    return entries as never
  })
  vi.mocked(loadPantry).mockImplementation(async () => {
    if (pantry instanceof Error) throw pantry
    return pantry as never
  })
  vi.mocked(loadShoppingList).mockImplementation(async () => {
    if (shoppingList instanceof Error) throw shoppingList
    return shoppingList as never
  })
}

/**
 * Signs in a user who owns a household with the given preferences row. The
 * dashboard reads meal types straight off this membership (HON-676).
 */
async function mockAuthedHouseholdSession(
  preferences: { weekdayMealTypes: MealType[]; weekendMealTypes: MealType[] } | null,
) {
  const { auth } = await import('@/lib/auth')
  const { getHouseholdMembership } = await import('@/lib/household')
  const now = new Date()

  vi.mocked(auth.api.getSession).mockResolvedValue({
    session: {
      id: 'session-123',
      userId: '123',
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      token: 'test-token',
      ipAddress: '127.0.0.1',
      userAgent: 'test',
      createdAt: now,
      updatedAt: now,
    },
    user: {
      id: '123',
      email: 'test@example.com',
      name: 'Test User',
      emailVerified: false,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  })

  vi.mocked(getHouseholdMembership).mockResolvedValue({
    id: 'member-123',
    householdId: 'household-123',
    userId: '123',
    role: 'owner',
    household: {
      id: 'household-123',
      name: 'Test Household',
      timezone: 'Europe/Tallinn',
      createdAt: now,
      preferences,
      _count: { members: 2 },
    },
  } as never)
}

/** One planned entry, an empty pantry and shopping list → <TimelineView />. */
function mockLoadersWithPlannedEntry() {
  return mockLoaders({ entries: { entries: [PLANNED_ENTRY], planId: 'plan-1' } })
}

/**
 * Renders the signed-out home. Server copy follows `translationLocale`; the
 * showcase's client components read the global `next-intl` mock
 * (`vitest.setup.ts`), which always resolves English.
 */
async function renderLanding() {
  const { auth } = await import('@/lib/auth')
  vi.mocked(auth.api.getSession).mockResolvedValue(null)
  // The demo's cook view mounts a mutation, so it needs a query client.
  const { wrapper } = createQueryWrapper()
  return render(await Home(), { wrapper })
}

describe('Home page component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    translationLocale = 'en'
    vi.mocked(getServerFlag).mockResolvedValue(true)
  })

  describe('private-beta notice (HON-847)', () => {
    beforeEach(async () => {
      const { auth } = await import('@/lib/auth')
      vi.mocked(auth.api.getSession).mockResolvedValue(null)
    })

    it('renders the notice with a link to ask support for an invite when invites are required', async () => {
      await renderLanding()

      expect(getServerFlag).toHaveBeenCalledWith('invite_code_required', 'anonymous')
      const notice = screen.getByRole('note', { name: 'Private beta notice' })
      expect(notice).toHaveTextContent(
        "We're in private beta, so sign-up needs an invite code. Don't have one? Ask for an invite at support@wobblepot.com.",
      )
      const link = within(notice).getByRole('link', { name: 'Ask for an invite' })
      expect(link).toHaveAttribute('href', 'mailto:support@wobblepot.com?subject=Invite%20request')
    })

    it('names the call to action after the code while invites are required', async () => {
      await renderLanding()

      // Once, under the hero: the header's Sign up covers the rest of the page.
      expect(screen.getByRole('link', { name: 'Sign up with your invite code' })).toHaveAttribute(
        'href',
        '/sign-up',
      )
      expect(screen.queryByRole('link', { name: 'Get started' })).not.toBeInTheDocument()
    })

    it('renders no notice when invites are not required', async () => {
      vi.mocked(getServerFlag).mockResolvedValue(false)

      await renderLanding()

      expect(screen.queryByRole('note')).not.toBeInTheDocument()
      expect(screen.queryByText(/private beta/i)).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Ask for an invite' })).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/sign-up')
      expect(screen.getByText("Free while we're in beta.")).toBeInTheDocument()
    })

    it('translates the notice label and the mail subject', async () => {
      translationLocale = 'et'

      await renderLanding()

      const notice = screen.getByRole('note', { name: 'Suletud beeta märguanne' })
      expect(screen.queryByRole('note', { name: 'Private beta notice' })).not.toBeInTheDocument()
      expect(within(notice).getByRole('link', { name: 'Küsi kutset' })).toHaveAttribute(
        'href',
        'mailto:support@wobblepot.com?subject=Soovin%20kutset',
      )
    })
  })

  it('does not read the invite flag for a signed-in user', async () => {
    await mockAuthedHouseholdSession(null)
    await mockLoadersWithPlannedEntry()

    await Home()

    expect(getServerFlag).not.toHaveBeenCalled()
  })

  it('renders landing page heading when not authenticated', async () => {
    await renderLanding()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Dinner, decided. For the whole week.' }),
    ).toBeInTheDocument()
  })

  it('renders no main landmark of its own when not authenticated', async () => {
    // The root layout's <main id="main-content"> is the page landmark; a second
    // one here would nest main inside main (HON-820).
    const { container } = await renderLanding()
    expect(container.querySelector('main')).toBeNull()
    expect(screen.queryByRole('main')).not.toBeInTheDocument()
  })

  it('renders value proposition when not authenticated', async () => {
    await renderLanding()
    expect(screen.getByText(/plans your family's meals around who's eating/)).toBeInTheDocument()
  })

  it('renders an example day drawn with the planner card', async () => {
    await renderLanding()
    // The hero's day comes first; the differences' vignettes are figures too.
    const figure = screen.getAllByRole('figure')[0]!
    expect(within(figure).getByText(/An example day in Wobblepot/)).toBeInTheDocument()
    expect(within(figure).getByText('Thursday')).toBeInTheDocument()
    for (const name of [
      'Avocado toast with poached egg',
      'Beef bibimbap',
      'Baked salmon with asparagus',
    ]) {
      expect(within(figure).getByText(name)).toBeInTheDocument()
      // Alt text is the meal name and nothing more (docs/DESIGN.md → Imagery).
      expect(within(figure).getByRole('img', { name })).toBeInTheDocument()
    }
  })

  it("renders today's meals from the library when the demo day loads", async () => {
    vi.mocked(loadDemoDay).mockResolvedValueOnce({
      date: '2026-10-01',
      meals: [
        {
          mealType: 'breakfast',
          servings: 4,
          steps: { steps: ['Toast the bread'], pitfalls: [] },
          meal: createMeal({ id: 'm-1', name: 'Avocado toast', primaryProteinType: 'eggs' }),
        },
        {
          mealType: 'lunch',
          servings: 4,
          steps: { steps: ['Cook the rice'], pitfalls: [] },
          meal: createMeal({ id: 'm-2', name: 'Beef bibimbap', primaryProteinType: 'beef' }),
        },
        {
          mealType: 'dinner',
          servings: 4,
          steps: { steps: ['Roast the salmon'], pitfalls: [] },
          meal: createMeal({ id: 'm-3', name: 'Baked salmon', primaryProteinType: 'fish' }),
        },
      ],
    })

    await renderLanding()

    expect(loadDemoDay).toHaveBeenCalledWith({ locale: 'en', date: expect.any(String) })
    // The hero's day comes first; the differences' vignettes are figures too.
    const figure = screen.getAllByRole('figure')[0]!
    // 2026-10-01 is a Thursday.
    expect(within(figure).getByText('Thursday')).toBeInTheDocument()
    expect(within(figure).getByRole('button', { name: 'Avocado toast' })).toBeInTheDocument()
    expect(within(figure).getByRole('button', { name: 'Baked salmon' })).toBeInTheDocument()
    expect(screen.queryByText('Avocado toast with poached egg')).not.toBeInTheDocument()
  })

  it('renders the three steps and the differences as sections', async () => {
    await renderLanding()
    expect(screen.getByRole('heading', { level: 2, name: 'How it works' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 3, name: "Tell it who's at the table" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 3, name: 'Get a week of meals' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 3, name: 'Shop once, then cook' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Made for family kitchens' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 3, name: 'It knows your pantry' }),
    ).toBeInTheDocument()
  })

  it('puts the trust line under the differences heading and ends the page there', async () => {
    await renderLanding()
    const why = screen.getByRole('region', { name: 'Made for family kitchens' })
    expect(
      within(why).getByText(
        'Made by a parent, for a family of three. Your data lives in the EU, and there are no ads.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: "Start with this week's dinners" }),
    ).not.toBeInTheDocument()
    const sections = screen.getAllByRole('region')
    expect(sections[sections.length - 1]).toBe(why)
  })

  it('renders the landing page in Estonian', async () => {
    translationLocale = 'et'
    await renderLanding()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Õhtusöök otsustatud. Terveks nädalaks.' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Kuidas see töötab' })).toBeInTheDocument()
    // "Made for family kitchens" is a client component, which this file's
    // next-intl mock renders in English: LandingFeatures.test.tsx renders it in
    // Estonian.
  })

  it('renders first-time setup when authenticated with household but no entries', async () => {
    const { auth } = await import('@/lib/auth')
    const { getHouseholdMembership } = await import('@/lib/household')
    const now = new Date()
    vi.mocked(auth.api.getSession).mockResolvedValue({
      session: {
        id: 'session-123',
        userId: '123',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
        token: 'test-token',
        ipAddress: '127.0.0.1',
        userAgent: 'test',
        createdAt: now,
        updatedAt: now,
      },
      user: {
        id: '123',
        email: 'test@example.com',
        name: 'Test User',
        emailVerified: false,
        image: null,
        createdAt: now,
        updatedAt: now,
      },
    })

    vi.mocked(getHouseholdMembership).mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: '123',
      role: 'owner',
      household: {
        id: 'household-123',
        name: 'Test Household',
        timezone: 'Europe/Tallinn',
        createdAt: now,
        preferences: null,
        // The page reads the household size off this `_count` (HON-596).
        _count: { members: 2 },
      },
    } as never)

    // No entries, no plan
    await mockLoaders()

    const component = await Home()
    render(component)
    expect(screen.getByTestId('first-time-setup')).toBeInTheDocument()
  })

  it('renders timeline view when authenticated with household and entries', async () => {
    const { auth } = await import('@/lib/auth')
    const { getHouseholdMembership } = await import('@/lib/household')
    const now = new Date()
    vi.mocked(auth.api.getSession).mockResolvedValue({
      session: {
        id: 'session-123',
        userId: '123',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
        token: 'test-token',
        ipAddress: '127.0.0.1',
        userAgent: 'test',
        createdAt: now,
        updatedAt: now,
      },
      user: {
        id: '123',
        email: 'test@example.com',
        name: 'Test User',
        emailVerified: false,
        image: null,
        createdAt: now,
        updatedAt: now,
      },
    })

    vi.mocked(getHouseholdMembership).mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: '123',
      role: 'owner',
      household: {
        id: 'household-123',
        name: 'Test Household',
        timezone: 'Europe/Tallinn',
        createdAt: now,
        preferences: null,
        // The page reads the household size off this `_count` (HON-596).
        _count: { members: 2 },
      },
    } as never)

    await mockLoadersWithPlannedEntry()

    const component = await Home()
    render(component)
    expect(screen.getByTestId('timeline-view')).toBeInTheDocument()
  })

  // A household with no `household_preferences` row used to crash the
  // dashboard render (HON-672); it must fall back to dinner-only.
  it('renders timeline view with default meal types when household has no preferences', async () => {
    const { TimelineView } = await import('@/components/timeline')
    await mockAuthedHouseholdSession(null)
    await mockLoadersWithPlannedEntry()

    const component = await Home()
    render(component)

    expect(screen.getByTestId('timeline-view')).toBeInTheDocument()
    expect(vi.mocked(TimelineView).mock.calls[0]?.[0].expectedMealTypes).toEqual({
      weekdayMealTypes: ['dinner'],
      weekendMealTypes: ['dinner'],
    })
  })

  it('passes stored household meal types to the timeline view', async () => {
    const { TimelineView } = await import('@/components/timeline')
    await mockAuthedHouseholdSession({
      weekdayMealTypes: ['breakfast', 'dinner'],
      weekendMealTypes: ['breakfast', 'lunch', 'dinner'],
    })
    await mockLoadersWithPlannedEntry()

    const component = await Home()
    render(component)

    expect(vi.mocked(TimelineView).mock.calls[0]?.[0].expectedMealTypes).toEqual({
      weekdayMealTypes: ['breakfast', 'dinner'],
      weekendMealTypes: ['breakfast', 'lunch', 'dinner'],
    })
  })

  // Custom items carry no date, so they reach the panel only as a count that
  // keeps its link to the list (HON-928).
  it('passes the count of unchecked custom items to the timeline view', async () => {
    const { TimelineView } = await import('@/components/timeline')
    await mockAuthedHouseholdSession(null)
    const customItem = (id: string, checked: boolean) => ({
      id,
      name: id,
      checked,
      ingredientId: null,
      ingredientCategory: null,
      createdAt: '2026-04-01T00:00:00.000Z',
    })
    await mockLoaders({
      entries: { entries: [PLANNED_ENTRY], planId: 'plan-1' },
      shoppingList: {
        ...EMPTY_SHOPPING_LIST,
        customItems: [
          customItem('foil', false),
          customItem('soap', true),
          customItem('tea', false),
        ],
      },
    })

    render(await Home())

    expect(vi.mocked(TimelineView).mock.calls[0]?.[0].openCustomItemCount).toBe(2)
  })

  // The preferences are already on the membership row (HON-676), and plan,
  // pantry and shopping data come from the loaders directly (HON-789): the
  // dashboard pays no server-to-self hop at all.
  it('does not fetch its own API routes', async () => {
    await mockAuthedHouseholdSession(null)
    await mockLoadersWithPlannedEntry()

    await Home()

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('reads the pantry and a 7-day shopping list for the household', async () => {
    const { loadPantry } = await import('@/lib/meal-planning/load-pantry')
    const { loadShoppingList } = await import('@/lib/shopping/load-shopping-list')
    await mockAuthedHouseholdSession(null)
    await mockLoadersWithPlannedEntry()

    await Home()

    expect(vi.mocked(loadPantry).mock.calls[0]?.[0]).toMatchObject({ id: 'household-123' })
    expect(vi.mocked(loadShoppingList).mock.calls[0]?.[1]).toEqual({ days: 7 })
  })

  // HON-1028: past days live on /past-meals and the header counts the ones
  // still to mark, so Today loads none of them.
  it('loads entries from today, not from past days', async () => {
    const { loadPlanEntries } = await import('@/lib/meal-planning/load-plan-entries')
    const { getTodayInTimezone, parseLocalDate } = await import('@/lib/meal-planning/dates')
    await mockAuthedHouseholdSession(null)
    await mockLoadersWithPlannedEntry()

    await Home()

    const [, query] = vi.mocked(loadPlanEntries).mock.calls[0]!
    expect(query.startDate).toEqual(parseLocalDate(getTodayInTimezone('Europe/Tallinn')))
  })

  it('maps pantry items and shopping items onto the timeline props', async () => {
    const { TimelineView } = await import('@/components/timeline')
    await mockAuthedHouseholdSession(null)
    await mockLoaders({
      entries: { entries: [PLANNED_ENTRY], planId: 'plan-1' },
      pantry: {
        items: [
          {
            id: 'pantry-1',
            ingredientId: 'ing-salt',
            ingredient: { id: 'ing-salt', name: 'Salt', category: 'spices', defaultUnit: 'g' },
            quantity: null,
            isStaple: true,
            updatedAt: new Date(),
          },
        ],
        windowDays: null,
      },
      shoppingList: {
        ...EMPTY_SHOPPING_LIST,
        groups: [
          {
            category: 'produce',
            categoryLabel: 'Produce',
            items: [
              {
                ingredientId: 'ing-onion',
                name: 'Onion',
                quantity: 2,
                unit: 'piece',
                displayQuantity: '2\u00a0pc',
                mealCount: 1,
                purchased: false,
                neededByDate: '2026-03-29',
                neededByRelative: 'Today',
                neededByAbsolute: 'Sun, 29 Mar',
                dueToday: true,
                isVague: false,
              },
            ],
          },
        ],
      },
    })

    render(await Home())

    const props = vi.mocked(TimelineView).mock.calls[0]?.[0]
    expect(props?.pantryIngredients).toEqual([{ ingredientId: 'ing-salt', isStaple: true }])
    expect(props?.shoppingItems).toEqual([
      expect.objectContaining({ ingredientId: 'ing-onion', name: 'Onion', purchased: false }),
    ])
  })

  // A failed read used to render as empty data: a pantry 500 showed Today as if
  // the pantry were empty (HON-789). Now it reaches `src/app/error.tsx`.
  it.each([
    ['pantry', { pantry: new Error('pantry down') }],
    ['shopping list', { shoppingList: new Error('shopping down') }],
  ])('surfaces a failed %s load instead of rendering an empty section', async (_, failure) => {
    const { TimelineView } = await import('@/components/timeline')
    await mockAuthedHouseholdSession(null)
    await mockLoaders({ entries: { entries: [PLANNED_ENTRY], planId: 'plan-1' }, ...failure })

    await expect(Home()).rejects.toThrow(/down/)
    expect(TimelineView).not.toHaveBeenCalled()
  })

  it('does not mistake a failed entries load for a first-time household', async () => {
    const { FirstTimeSetup } = await import('@/components/timeline')
    await mockAuthedHouseholdSession(null)
    await mockLoaders({ entries: new Error('entries down') })

    await expect(Home()).rejects.toThrow('entries down')
    expect(FirstTimeSetup).not.toHaveBeenCalled()
  })

  it('redirects to onboarding when authenticated without household', async () => {
    const { auth } = await import('@/lib/auth')
    const { getHouseholdMembership } = await import('@/lib/household')
    const now = new Date()
    vi.mocked(auth.api.getSession).mockResolvedValue({
      session: {
        id: 'session-123',
        userId: '123',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
        token: 'test-token',
        ipAddress: '127.0.0.1',
        userAgent: 'test',
        createdAt: now,
        updatedAt: now,
      },
      user: {
        id: '123',
        email: 'test@example.com',
        name: 'Test User',
        emailVerified: false,
        image: null,
        createdAt: now,
        updatedAt: now,
      },
    })

    vi.mocked(getHouseholdMembership).mockResolvedValue(null)

    await expect(Home()).rejects.toThrow('NEXT_REDIRECT:/onboarding')
  })
})
