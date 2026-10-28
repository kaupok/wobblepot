import 'server-only'
import { prisma } from '@/lib/prisma'
import { MealPlanEntryStatus } from '@/generated/prisma/enums'
import { getTodayInTimezone, parseLocalDate } from '@/lib/meal-planning/dates'
import { mealTranslationsInclude, translateMeal } from '@/lib/i18n/content'

/** How many days back Past meals looks for the household's usual meals (HON-1383). */
export const LOG_LOOKBACK_DAYS = 30

/** Meals and labels offered at once, so the rest of the picker stays in reach. */
const FREQUENT_MEALS_MAX = 10
const RECENT_LABELS_MAX = 12

/** A meal the household cooked lately, which the log picker lists first. */
export interface FrequentMeal {
  id: string
  name: string
}

/** `[today − 30, today]` in the household's day, as an exclusive-end range. */
function lookback(timezone: string, now: Date) {
  const today = parseLocalDate(getTodayInTimezone(timezone, now))
  const startDate = new Date(today)
  startDate.setDate(startDate.getDate() - LOG_LOOKBACK_DAYS)
  const endDate = new Date(today)
  endDate.setDate(endDate.getDate() + 1)
  return { gte: startDate, lt: endDate }
}

/**
 * The recipe meals the household cooked in the last 30 days of its own day,
 * most often first, and the latest first among equals. A household's rotation
 * is small, so the meal it logs is near the top (HON-1383). Only completed
 * entries count: a planned or skipped meal was not eaten.
 */
export async function loadFrequentMeals(
  household: { id: string; timezone: string; locale: string | null },
  now: Date = new Date(),
): Promise<FrequentMeal[]> {
  const groups = await prisma.mealPlanEntry.groupBy({
    by: ['mealId'],
    where: {
      plan: { householdId: household.id },
      date: lookback(household.timezone, now),
      status: MealPlanEntryStatus.completed,
      kind: 'meal',
      mealId: { not: null },
      // A deleted recipe cannot be logged (`createEntry` refuses it), so it
      // takes none of the places.
      meal: { deletedAt: null },
    },
    _count: { _all: true },
    _max: { date: true },
    orderBy: [{ _count: { mealId: 'desc' } }, { _max: { date: 'desc' } }, { mealId: 'asc' }],
    take: FREQUENT_MEALS_MAX,
  })
  const ids = groups.flatMap((g) => (g.mealId ? [g.mealId] : []))
  if (ids.length === 0) return []

  const meals = await prisma.meal.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, ...mealTranslationsInclude(household.locale) },
  })
  const byId = new Map(meals.map((meal) => [meal.id, meal]))
  return ids.flatMap((id) => {
    const meal = byId.get(id)
    return meal ? [{ id, name: translateMeal(meal, household.locale).name }] : []
  })
}

/**
 * The free-text items of the household's fridge meals in the last 30 days of
 * its own day, latest first, each once. The fridge-meal picker offers them as
 * one-tap chips, so "Wolt" stays one label and the counts stay right
 * (HON-1383).
 */
export async function loadRecentFridgeLabels(
  household: { id: string; timezone: string },
  now: Date = new Date(),
): Promise<string[]> {
  const items = await prisma.mealPlanEntryItem.findMany({
    where: {
      label: { not: null },
      entry: { plan: { householdId: household.id }, date: lookback(household.timezone, now) },
    },
    orderBy: [{ entry: { date: 'desc' } }, { entry: { mealType: 'desc' } }, { position: 'asc' }],
    select: { label: true },
  })
  const labels: string[] = []
  const seen = new Set<string>()
  for (const { label } of items) {
    if (!label) continue
    const key = label.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    labels.push(label)
    if (labels.length === RECENT_LABELS_MAX) break
  }
  return labels
}
