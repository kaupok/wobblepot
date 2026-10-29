import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-keys', () => ({
  API_KEY_PATTERN: /^wp_[A-Za-z0-9]{32}$/,
  verifyApiKey: vi.fn().mockResolvedValue({ userId: 'user-1' }),
  isActiveApiKeyUser: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/household', () => ({ getHouseholdMembership: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: new Date() }),
  retryAfterSeconds: vi.fn(),
}))
vi.mock('@/lib/errors', () => ({ captureApiError: vi.fn() }))
vi.mock('@/lib/meal-planning/load-plan-entries', () => ({ loadPlanEntries: vi.fn() }))
vi.mock('@/lib/day-extras/day-extras', () => ({ loadDayExtras: vi.fn() }))

import { loadDayExtras } from '@/lib/day-extras/day-extras'
import { getHouseholdMembership } from '@/lib/household'
import { runTool } from '@/lib/mcp/context'
import { getMealPlan } from '@/lib/mcp/tools/get-meal-plan'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import { mcpHousehold, READ_SCOPES } from '@/test/mcp'

import { GET } from './route'

type Entries = Awaited<ReturnType<typeof loadPlanEntries>>['entries']

const KEY = 'wp_abcdefghijklmnopqrstuvwxyz012345'
const household = mcpHousehold({ id: 'household-1', timezone: 'Europe/Tallinn' })

const ENTRIES = [
  {
    id: 'entry-1',
    date: '2026-10-12',
    mealType: 'dinner',
    status: 'planned',
    kind: 'meal',
    items: [],
    servingOverride: null,
    cookServings: 4.5,
    leftoversFor: [{ date: '2026-10-14', mealType: 'dinner', servings: 2.5 }],
    meal: { id: 'meal-1', name: 'Chicken soup' },
  },
  {
    id: 'entry-2',
    date: '2026-10-13',
    mealType: 'lunch',
    status: 'skipped',
    kind: 'meal',
    items: [],
    servingOverride: 3,
    cookServings: 3,
    leftoversFor: [],
    meal: { id: 'meal-2', name: 'Pancakes' },
  },
  {
    id: 'entry-3',
    date: '2026-10-14',
    mealType: 'dinner',
    status: 'planned',
    kind: 'fridge',
    items: [
      {
        ingredientId: 'ing-peas',
        sourceEntryId: null,
        label: null,
        name: 'Frozen peas',
        servings: null,
      },
      {
        ingredientId: null,
        sourceEntryId: 'entry-1',
        label: null,
        name: 'Chicken soup',
        servings: 2.5,
      },
      { ingredientId: null, sourceEntryId: null, label: 'Meatballs', name: null, servings: null },
    ],
    servingOverride: null,
    cookServings: 2,
    leftoversFor: [],
    meal: null,
  },
] as unknown as Entries

const EXTRAS = [
  {
    id: 'extra-1',
    date: '2026-10-13',
    ingredientId: 'ing-wine',
    name: 'Red wine',
    quantity: 750,
    unit: 'ml' as const,
  },
  {
    id: 'extra-2',
    date: '2026-10-13',
    ingredientId: null,
    name: 'chips',
    quantity: null,
    unit: null,
  },
]

function get(query = '') {
  return GET(
    new Request(`http://localhost:3000/api/v1/meal-plan${query}`, {
      headers: { authorization: `Bearer ${KEY}` },
    }),
  )
}

describe('GET /api/v1/meal-plan (HON-1220)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-11T21:30:00Z'))
    vi.mocked(getHouseholdMembership).mockResolvedValue({ household } as never)
    vi.mocked(loadPlanEntries).mockResolvedValue({ entries: ENTRIES, planId: 'plan-1' })
    vi.mocked(loadDayExtras).mockResolvedValue(EXTRAS)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('answers the same JSON as get_meal_plan for the same range', async () => {
    const response = await get('?from=2026-10-12&to=2026-10-14')
    const tool = await runTool(
      getMealPlan,
      { userId: 'user-1', household, scopes: READ_SCOPES },
      { from: '2026-10-12', to: '2026-10-14' },
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual(tool.structuredContent)
    expect(body).toEqual({
      from: '2026-10-12',
      to: '2026-10-14',
      entries: [
        {
          entryId: 'entry-1',
          date: '2026-10-12',
          mealType: 'dinner',
          kind: 'recipe',
          items: [],
          mealId: 'meal-1',
          mealName: 'Chicken soup',
          servings: 2,
          cookServings: 4.5,
          leftoversFor: [{ date: '2026-10-14', mealType: 'dinner', servings: 2.5 }],
          isCooked: false,
          isSkipped: false,
        },
        {
          entryId: 'entry-2',
          date: '2026-10-13',
          mealType: 'lunch',
          kind: 'recipe',
          items: [],
          mealId: 'meal-2',
          mealName: 'Pancakes',
          servings: 3,
          cookServings: 3,
          leftoversFor: [],
          isCooked: false,
          isSkipped: true,
        },
        {
          entryId: 'entry-3',
          date: '2026-10-14',
          mealType: 'dinner',
          kind: 'fridge',
          items: [
            { name: 'Frozen peas', source: 'pantry', sourceEntryId: null, servings: null },
            { name: 'Chicken soup', source: 'leftover', sourceEntryId: 'entry-1', servings: 2.5 },
            { name: 'Meatballs', source: 'text', sourceEntryId: null, servings: null },
          ],
          mealId: null,
          mealName: null,
          servings: 2,
          cookServings: 2,
          leftoversFor: [],
          isCooked: false,
          isSkipped: false,
        },
      ],
      extras: [
        {
          id: 'extra-1',
          date: '2026-10-13',
          name: 'Red wine',
          kind: 'ingredient',
          quantity: 750,
          unit: 'ml',
        },
        {
          id: 'extra-2',
          date: '2026-10-13',
          name: 'chips',
          kind: 'text',
          quantity: null,
          unit: null,
        },
      ],
    })
  })

  it("defaults to today and the next 6 days in the household's timezone", async () => {
    const body = await (await get()).json()

    expect(body.from).toBe('2026-10-12')
    expect(body.to).toBe('2026-10-18')
  })

  it.each([
    ['a date that is not YYYY-MM-DD', '?from=12.10.2026', 'Give from and to as dates, YYYY-MM-DD.'],
    [
      'a range the wrong way round',
      '?from=2026-10-14&to=2026-10-12',
      'The date "to" is before "from". Ask again with to on or after from.',
    ],
    [
      'more than 31 days',
      '?from=2026-10-01&to=2026-11-01',
      'Ask for 31 days or fewer in one call.',
    ],
  ])('answers 400 bad_request for %s', async (_label, query, error) => {
    const response = await get(query)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'bad_request', error })
    expect(loadPlanEntries).not.toHaveBeenCalled()
  })

  it('answers 401 before it reads the query for a request without a key', async () => {
    const response = await GET(new Request('http://localhost:3000/api/v1/meal-plan?from=bad'))

    expect(response.status).toBe(401)
    expect((await response.json()).code).toBe('invalid_key')
  })
})
