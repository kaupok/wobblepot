import { vi } from 'vitest'

import { getTodayInTimezone, parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { prisma } from '@/lib/prisma'
import { mcpHousehold, READ_SCOPES, WRITE_SCOPES } from '@/test/mcp'

import type { applyPlan as ApplyPlan } from './apply-plan'
import type { checkPlan as CheckPlan } from './check-plan'

// Shared setup of the `check_plan` and `apply_plan` db tests (HON-1652). Each
// test file mocks the rate limiter as allowed, because it would call Upstash,
// and calls `loadTools` in `beforeAll`: the `unit-db` project shares one module
// cache (`isolate: false`), so the tools are imported fresh, as
// `fill-plan.db.test.ts` does. Vitest runs in UTC, so the household does too,
// and every date is relative to the real today.

export let runTool: typeof import('@/lib/mcp/context').runTool
export let applyPlan: typeof ApplyPlan
export let checkPlan: typeof CheckPlan

export async function loadTools() {
  vi.resetModules()
  ;[{ runTool }, { applyPlan }, { checkPlan }] = await Promise.all([
    import('@/lib/mcp/context'),
    import('./apply-plan'),
    import('./check-plan'),
  ])
}

const TIMEZONE = 'UTC'

export function day(offset: number): string {
  const date = parseLocalDate(getTodayInTimezone(TIMEZONE))
  date.setDate(date.getDate() + offset)
  return toDateString(date)
}

/**
 * Alder, two members, so a meal without servings cooks for 2. Stew and
 * goulash are beef dinners, soup has no protein, and the cheese bake holds
 * dairy. The pantry ran out of beef.
 */
export async function world(preferences: Record<string, unknown> | null = null) {
  const alder = await prisma.household.create({
    data: {
      name: 'Alder',
      locale: 'en',
      timezone: TIMEZONE,
      members: { create: [{ name: 'A' }, { name: 'B' }] },
      mealPlans: { create: { id: 'plan-alder' } },
    },
  })
  const ingredient = (id: string, name: string, data: Record<string, unknown> = {}) =>
    prisma.ingredient.create({
      data: {
        id,
        name,
        category: 'protein',
        defaultUnit: 'g',
        calories: 1,
        protein: 0,
        carbs: 0,
        fat: 0,
        ...data,
      },
    })
  await ingredient('ing-beef', 'glimmer beef')
  await ingredient('ing-cheese', 'glimmer cheese', { allergens: ['dairy'] })
  const meal = (id: string, name: string, data: Record<string, unknown>) =>
    prisma.meal.create({ data: { id, name, suitableFor: ['lunch', 'dinner'], ...data } })
  await meal('stew', 'Glimmer stew', {
    primaryProteinType: 'beef',
    timeMinutes: 90,
    components: { create: { ingredientId: 'ing-beef', quantityPerServing: 100 } },
  })
  await meal('goulash', 'Glimmer goulash', { primaryProteinType: 'beef' })
  await meal('soup', 'Glimmer soup', { primaryProteinType: 'none' })
  await meal('bake', 'Glimmer cheese bake', {
    components: { create: { ingredientId: 'ing-cheese', quantityPerServing: 50 } },
  })
  await prisma.pantryItem.create({
    data: { householdId: alder.id, ingredientId: 'ing-beef', quantity: 0 },
  })
  return mcpHousehold({
    id: alder.id,
    locale: 'en',
    timezone: TIMEZONE,
    preferences: preferences as never,
  })
}

export type Household = Awaited<ReturnType<typeof world>>

export async function check(household: Household, slots: unknown[]) {
  const result = await runTool(
    checkPlan,
    { userId: 'user-1', household, scopes: READ_SCOPES },
    checkPlan.inputSchema.parse({ slots }),
  )
  return result.structuredContent as Awaited<ReturnType<typeof CheckPlan.run>>
}

export async function apply(household: Household, slots: unknown[], restoreToken?: string) {
  const result = await runTool(
    applyPlan,
    { userId: 'user-1', household, scopes: WRITE_SCOPES },
    applyPlan.inputSchema.parse({ slots, restoreToken }),
  )
  return result.structuredContent as Awaited<ReturnType<typeof ApplyPlan.run>>
}

export function entry(
  id: string,
  date: string,
  mealType: string,
  data: Record<string, unknown> = {},
) {
  return prisma.mealPlanEntry.create({
    data: { id, planId: 'plan-alder', date: parseLocalDate(date), mealType, ...data } as never,
  })
}

export function slotRows(date: string, mealType: string) {
  return prisma.mealPlanEntry.findMany({
    where: { planId: 'plan-alder', date: parseLocalDate(date), mealType: mealType as never },
    include: { items: { orderBy: { position: 'asc' } } },
  })
}
