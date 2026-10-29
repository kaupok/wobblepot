import { describe, expect, it } from 'vitest'

import { getTodayInTimezone, parseLocalDate } from '@/lib/meal-planning/dates'
import { prisma } from '@/lib/prisma'

import { loadCandidatePools } from './plan-candidates'

// Plan generation may pick a meal the household planned recently, because a
// family plans from a rotation on purpose (HON-1393). `validatePlan` still
// keeps one generated plan from having a dinner twice. Runs against PGlite
// through the `unit-db` project, with no mocks.

describe('loadCandidatePools and recent history', () => {
  it('offers a dinner planned yesterday', async () => {
    const today = parseLocalDate(getTodayInTimezone('UTC'))
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    const household = await prisma.household.create({
      data: { name: 'Hazel', mealPlans: { create: { id: 'plan-hazel' } } },
    })
    await prisma.meal.create({
      data: {
        id: 'hazel-curry',
        name: 'Hazel curry',
        suitableFor: ['dinner'],
        householdId: household.id,
      },
    })
    await prisma.mealPlanEntry.create({
      data: { planId: 'plan-hazel', date: yesterday, mealType: 'dinner', mealId: 'hazel-curry' },
    })

    const { candidatesByMealType } = await loadCandidatePools({
      slots: [{ date: today, mealType: 'dinner' }],
      householdId: household.id,
      allergensToAvoid: [],
      excludedIngredientIds: [],
      dietaryType: null,
      favoriteMealIds: [],
    })

    expect(candidatesByMealType.get('dinner')?.map((meal) => meal.id)).toContain('hazel-curry')
  })
})
