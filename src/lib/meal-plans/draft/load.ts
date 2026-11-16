import 'server-only'

import { loadHouseholdServings } from '@/lib/household'
import { mealTranslationsInclude, translateMeal } from '@/lib/i18n/content'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { isMealAllowedForSlot } from '@/lib/meal-planning/meal-allowed-for-slot'
import { shoppingIngredientArgs } from '@/lib/meal-planning/pantry-shopping-lines'
import { writableDays } from '@/lib/meal-planning/writable-days'
import { visibleMealWhere } from '@/lib/meals/load-meals'
import { prisma } from '@/lib/prisma'

import { type DraftContext, type DraftHousehold, fitKey, type StoredEntry } from './context'
import { type DraftSlot, slotKey } from './schema'

/**
 * Everything the draft's check reads, in one pass: the stored plan around the
 * draft's days, the meals it names and their rules, its ingredients and the
 * pantry. The rules, the week, the needs and `previous` are then pure.
 */
export async function loadDraftContext(
  household: DraftHousehold,
  slots: readonly DraftSlot[],
): Promise<DraftContext> {
  const locale = resolveHouseholdLocale(household)
  const { today, lastDay } = writableDays(household.timezone)

  const items = slots.flatMap((slot) => ('items' in slot ? slot.items : []))
  const sourceEntryIds = items.flatMap((item) =>
    'sourceEntryId' in item ? [item.sourceEntryId] : [],
  )
  const ingredientIds = items.flatMap((item) => ('ingredientId' in item ? [item.ingredientId] : []))
  // A day before the first slot or source, and a day after the last slot, so
  // the protein check sees the kept dinners next to the draft.
  const days = [
    ...slots.map((slot) => slot.date),
    ...items.flatMap((item) => ('leftoverOf' in item ? [item.leftoverOf.date] : [])),
  ].sort()
  // The schema asks for one slot at least, so `days` is never empty.
  const start = parseLocalDate(days[0] ?? today)
  start.setDate(start.getDate() - 1)
  const end = parseLocalDate(days.at(-1) ?? today)
  end.setDate(end.getDate() + 2)

  const mealTypesByMeal = new Map<string, Set<string>>()
  for (const slot of slots) {
    if (!('mealId' in slot)) continue
    const types = mealTypesByMeal.get(slot.mealId) ?? new Set()
    types.add(slot.mealType)
    mealTypesByMeal.set(slot.mealId, types)
  }
  const mealIds = [...mealTypesByMeal.keys()]

  const [entries, meals, ingredients, householdServings, fits] = await Promise.all([
    prisma.mealPlanEntry.findMany({
      where: {
        plan: { householdId: household.id },
        OR: [{ date: { gte: start, lt: end } }, { id: { in: sourceEntryIds } }],
      },
      select: {
        id: true,
        date: true,
        mealType: true,
        status: true,
        kind: true,
        mealId: true,
        mainEntryId: true,
        servingOverride: true,
        cookedServings: true,
        note: true,
        adjustmentNote: true,
        _count: { select: { changes: true, sides: true } },
        meal: {
          select: {
            id: true,
            name: true,
            timeMinutes: true,
            primaryProteinType: true,
            ...mealTranslationsInclude(locale),
          },
        },
        items: {
          orderBy: { position: 'asc' },
          select: {
            ingredientId: true,
            sourceEntryId: true,
            label: true,
            servings: true,
            sourceEntry: { select: { date: true, mealType: true } },
          },
        },
        leftoverItems: {
          select: {
            servings: true,
            entry: { select: { id: true, date: true, mealType: true, status: true } },
          },
        },
      },
    }),
    mealIds.length === 0
      ? []
      : prisma.meal.findMany({
          where: { id: { in: mealIds }, ...visibleMealWhere(household.id) },
          select: {
            id: true,
            name: true,
            timeMinutes: true,
            primaryProteinType: true,
            ...mealTranslationsInclude(locale),
            components: {
              select: {
                ingredientId: true,
                quantityPerServing: true,
                isVague: true,
                originalPhrase: true,
                ingredient: shoppingIngredientArgs(locale),
              },
            },
          },
        }),
    ingredientIds.length === 0
      ? []
      : prisma.ingredient.findMany({
          where: {
            id: { in: ingredientIds },
            OR: [{ householdId: null }, { householdId: household.id }],
          },
          select: { id: true },
        }),
    loadHouseholdServings(household.id),
    Promise.all(
      [...mealTypesByMeal].flatMap(([mealId, types]) =>
        [...types].map(async (mealType) => {
          const fit = await isMealAllowedForSlot(
            household,
            mealId,
            mealType as DraftSlot['mealType'],
          )
          return [fitKey(mealId, mealType), fit] as const
        }),
      ),
    ),
  ])

  const componentIngredientIds = [
    ...new Set(meals.flatMap((meal) => meal.components.map((c) => c.ingredientId))),
  ]
  const pantryRows =
    componentIngredientIds.length === 0
      ? []
      : await prisma.pantryItem.findMany({
          where: { householdId: household.id, ingredientId: { in: componentIngredientIds } },
          select: { ingredientId: true, quantity: true, lowAt: true },
        })

  const stored = new Map<string, StoredEntry>()
  const mains = new Map<string, StoredEntry>()
  for (const entry of entries) {
    const row: StoredEntry = {
      id: entry.id,
      date: toDateString(entry.date),
      mealType: entry.mealType,
      status: entry.status,
      kind: entry.kind,
      mealId: entry.mealId,
      mainEntryId: entry.mainEntryId,
      servingOverride: entry.servingOverride,
      cookedServings: entry.cookedServings,
      note: entry.note,
      hasChanges: entry._count.changes > 0 || entry.adjustmentNote !== null,
      sideCount: entry._count.sides,
      meal: entry.meal && {
        id: entry.meal.id,
        name: translateMeal(entry.meal, locale).name,
        timeMinutes: entry.meal.timeMinutes,
        primaryProteinType: entry.meal.primaryProteinType,
      },
      items: entry.items.map((item) => ({
        ingredientId: item.ingredientId,
        sourceEntryId: item.sourceEntryId,
        label: item.label,
        servings: item.servings,
        source: item.sourceEntry && {
          date: toDateString(item.sourceEntry.date),
          mealType: item.sourceEntry.mealType,
        },
      })),
      leftoverItems: entry.leftoverItems.map((item) => ({
        servings: item.servings,
        entryId: item.entry.id,
        date: toDateString(item.entry.date),
        mealType: item.entry.mealType,
        status: item.entry.status,
      })),
    }
    stored.set(row.id, row)
    if (row.mainEntryId === null) mains.set(slotKey(row), row)
  }

  return {
    locale,
    today,
    lastDay,
    householdServings,
    stored,
    mains,
    meals: new Map(
      meals.map((meal) => [
        meal.id,
        {
          id: meal.id,
          name: translateMeal(meal, locale).name,
          timeMinutes: meal.timeMinutes,
          primaryProteinType: meal.primaryProteinType,
          components: meal.components,
        },
      ]),
    ),
    fits: new Map(fits),
    ingredientIds: new Set(ingredients.map((ingredient) => ingredient.id)),
    pantry: new Map(
      pantryRows.map((row) => [
        row.ingredientId,
        { quantity: row.quantity, low: row.lowAt !== null },
      ]),
    ),
  }
}
