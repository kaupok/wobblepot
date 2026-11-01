import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TimelineView } from '@/components/timeline'
import { loadDayExtras } from '@/lib/day-extras/day-extras'
import { loadPantry } from '@/lib/meal-planning/load-pantry'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import { loadShoppingList } from '@/lib/shopping/load-shopping-list'

import { TodayTimeline } from './TodayTimeline'

// What Today hands the timeline for the shopping panel's "At home" tab and the
// meal cards (HON-1578). `page.test.tsx` covers the rest of the page.

vi.mock('@/components/timeline', () => ({ TimelineView: vi.fn(), FirstTimeSetup: vi.fn() }))
vi.mock('@/lib/meal-planning/load-plan-entries', () => ({ loadPlanEntries: vi.fn() }))
vi.mock('@/lib/meal-planning/load-pantry', () => ({ loadPantry: vi.fn() }))
vi.mock('@/lib/shopping/load-shopping-list', () => ({ loadShoppingList: vi.fn() }))
vi.mock('@/lib/day-extras/day-extras', () => ({ loadDayExtras: vi.fn() }))

// Noon on Sunday 29 March in Tallinn.
const NOW = new Date('2026-03-29T09:00:00Z')

const household = {
  id: 'household-1',
  timezone: 'Europe/Tallinn',
  preferences: null,
  members: [{ preferences: null }],
} as never

function pantryRow(id: string, quantity: number | null) {
  return {
    id: `pantry-${id}`,
    ingredientId: id,
    ingredient: { id, name: id, category: 'produce', defaultUnit: 'g' },
    quantity,
    isStaple: false,
    updatedAt: NOW,
  }
}

function atHome(name: string, neededByDate: string) {
  return {
    ingredientId: `ing-${name}`,
    name,
    displayQuantity: '200g',
    neededByDate,
    pantryRows: [{ id: `pantry-${name}`, quantity: null }],
    isStaple: false,
  }
}

/** Renders Today and returns the props it gave `TimelineView`. */
async function timelineProps({
  pantry = [] as ReturnType<typeof pantryRow>[],
  atHomeRows = [] as ReturnType<typeof atHome>[],
} = {}) {
  vi.mocked(loadPlanEntries).mockResolvedValue({ entries: [], planId: 'plan-1' } as never)
  vi.mocked(loadPantry).mockResolvedValue({ items: pantry, windowDays: null } as never)
  vi.mocked(loadShoppingList).mockResolvedValue({
    groups: [],
    customItems: [],
    atHome: atHomeRows,
  } as never)
  vi.mocked(loadDayExtras).mockResolvedValue([] as never)
  const element = await TodayTimeline({ household, userName: 'Test' })
  return element.props as Parameters<typeof TimelineView>[0]
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('TodayTimeline', () => {
  it('leaves a pantry row at 0 out of the ingredients the meal cards count', async () => {
    const props = await timelineProps({
      pantry: [pantryRow('ing-rice', null), pantryRow('ing-acai', 0), pantryRow('ing-oats', 200)],
    })

    expect(props.pantryIngredients).toEqual([
      { ingredientId: 'ing-rice', isStaple: false },
      { ingredientId: 'ing-oats', isStaple: false },
    ])
  })

  it('passes the at-home rows with their day, bucketed against the household today', async () => {
    const props = await timelineProps({
      atHomeRows: [atHome('rice', '2026-03-29'), atHome('oats', '2026-03-30')],
    })

    expect(props.atHomeItems).toEqual([
      { ...atHome('rice', '2026-03-29'), urgency: 'today' },
      { ...atHome('oats', '2026-03-30'), urgency: 'tomorrow' },
    ])
  })
})
