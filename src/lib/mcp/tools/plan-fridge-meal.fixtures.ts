import { prisma } from '@/lib/prisma'
import { getTodayInTimezone, parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import { ToolInputError } from '@/lib/mcp/context'
import { mcpHousehold } from '@/test/mcp'
import { planFridgeMeal } from './plan-fridge-meal'

// Shared setup of the `plan_fridge_meal` db tests (HON-1281, HON-1394). Vitest
// runs in UTC, so the household does too, and every date is relative to the
// real today.

export const CALLER = { userId: 'user-1' }
export const TIMEZONE = 'UTC'

export function day(offset: number): string {
  const date = parseLocalDate(getTodayInTimezone(TIMEZONE))
  date.setDate(date.getDate() + offset)
  return toDateString(date)
}

/**
 * Alder has a plan, a shared stew, a shared pea ingredient, its own Estonian
 * name for the peas, and yesterday's dinner of stew, cooked. Birch is a second
 * household with its own ingredient and a cooked entry of its own.
 */
export async function world({ locale = 'en' } = {}) {
  const ingredient = (id: string, name: string, householdId?: string) =>
    prisma.ingredient.create({
      data: {
        id,
        name,
        category: 'vegetable',
        defaultUnit: 'g',
        calories: 1,
        protein: 0,
        carbs: 0,
        fat: 0,
        ...(householdId ? { householdId } : {}),
      },
    })
  const alder = await prisma.household.create({
    data: {
      name: 'Alder',
      locale,
      timezone: TIMEZONE,
      mealPlans: { create: { id: 'plan-alder' } },
    },
  })
  const birch = await prisma.household.create({
    data: { name: 'Birch', mealPlans: { create: { id: 'plan-birch' } } },
  })
  await ingredient('ing-peas', 'glimmer peas')
  await prisma.ingredientTranslation.create({
    data: { ingredientId: 'ing-peas', locale: 'et', name: 'helkherned' },
  })
  await ingredient('ing-birch', 'birch secret', birch.id)
  await prisma.meal.create({ data: { id: 'stew', name: 'Glimmer stew', suitableFor: ['dinner'] } })
  await prisma.mealPlanEntry.create({
    data: {
      id: 'entry-cooked',
      planId: 'plan-alder',
      date: parseLocalDate(day(-1)),
      mealType: 'dinner',
      mealId: 'stew',
      status: 'completed',
    },
  })
  await prisma.mealPlanEntry.create({
    data: {
      id: 'entry-birch',
      planId: 'plan-birch',
      date: parseLocalDate(day(-1)),
      mealType: 'dinner',
      mealId: 'stew',
      status: 'completed',
    },
  })

  return mcpHousehold({ id: alder.id, locale, timezone: TIMEZONE })
}

export type Household = Awaited<ReturnType<typeof world>>

export const ITEMS = [
  { ingredientId: 'ing-peas' },
  { sourceEntryId: 'entry-cooked' },
  { label: 'Meatballs' },
]

export function call(household: Household, input: Record<string, unknown>) {
  return planFridgeMeal.run(household, planFridgeMeal.inputSchema.parse(input), CALLER)
}

/** What the slot holds, as the app's card reads it through `loadPlanEntries`. */
export async function slot(household: Household, date: string) {
  const start = parseLocalDate(date)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const { entries } = await loadPlanEntries(household, { startDate: start, endDate: end })
  return entries.filter((entry) => entry.mealType === 'dinner')
}

export async function dinnerOn(date: string) {
  return prisma.mealPlanEntry.findMany({
    where: { planId: 'plan-alder', date: parseLocalDate(date), mealType: 'dinner' },
    include: { items: { orderBy: { position: 'asc' } } },
  })
}

export async function refusal(household: Household, input: Record<string, unknown>) {
  const error = await call(household, input).then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof ToolInputError)) throw new Error(`Expected a refusal, got ${error}`)
  return error.message
}
