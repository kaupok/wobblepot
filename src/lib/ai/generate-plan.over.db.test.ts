import { describe, expect, it } from 'vitest'

import { generateMealPlan } from '@/lib/ai/generate-plan'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { prisma } from '@/lib/prisma'

// Generate leaves the entries in a slot that is over untouched, sides included
// (HON-1523). Runs against PGlite with no mocks: every configured slot is over,
// so Generate makes no AI call and only clears the range.

const MONDAY = parseLocalDate('2026-01-12')
// 15:00 in Tallinn (UTC+2 in January): breakfast and lunch are over, dinner is not.
const AT_15 = new Date('2026-01-12T13:00:00Z')

async function world() {
  await prisma.meal.create({ data: { id: 'meal-main', name: 'Main' } })
  await prisma.meal.create({ data: { id: 'meal-side', name: 'Side' } })
  const household = await prisma.household.create({
    data: {
      name: 'Birch',
      timezone: 'Europe/Tallinn',
      mealPlans: { create: { id: 'plan-birch' } },
    },
  })
  return household.id
}

async function slotWithSide(
  prefix: string,
  mealType: 'breakfast' | 'lunch' | 'dinner',
  status: 'planned' | 'skipped',
) {
  const slot = { planId: 'plan-birch', date: MONDAY, mealType }
  await prisma.mealPlanEntry.create({
    data: { id: prefix, ...slot, mealId: 'meal-main', status, note: `${prefix} note` },
  })
  await prisma.mealPlanEntry.create({
    data: { id: `${prefix}-side`, ...slot, mealId: 'meal-side', mainEntryId: prefix, status },
  })
}

describe('generateMealPlan with slots that are over (HON-1523)', () => {
  it('keeps planned and skipped entries in the slots that are over, with their sides', async () => {
    const householdId = await world()
    await slotWithSide('breakfast', 'breakfast', 'planned')
    await slotWithSide('lunch', 'lunch', 'skipped')
    // Dinner is not over at 15:00, so its entry is cleared as before.
    await slotWithSide('dinner', 'dinner', 'planned')

    await generateMealPlan({
      householdId,
      startDate: MONDAY,
      endDate: parseLocalDate('2026-01-13'),
      dietaryType: null,
      allergensToAvoid: [],
      excludedIngredientIds: [],
      restrictions: [],
      locale: 'en',
      timezone: 'Europe/Tallinn',
      now: AT_15,
      weekdayMealTypes: ['breakfast', 'lunch'],
      weekendMealTypes: ['breakfast', 'lunch'],
    })

    const left = await prisma.mealPlanEntry.findMany({
      where: { planId: 'plan-birch' },
      select: { id: true, status: true, note: true, mealId: true },
      orderBy: { id: 'asc' },
    })
    expect(left).toEqual([
      { id: 'breakfast', status: 'planned', note: 'breakfast note', mealId: 'meal-main' },
      { id: 'breakfast-side', status: 'planned', note: null, mealId: 'meal-side' },
      { id: 'lunch', status: 'skipped', note: 'lunch note', mealId: 'meal-main' },
      { id: 'lunch-side', status: 'skipped', note: null, mealId: 'meal-side' },
    ])
  })
})
