import { IngredientCategory, type PieceDisplay, Unit } from '@/generated/prisma/enums'
import { extraAggregationEntries } from '@/lib/day-extras/shopping'
import { loadHouseholdServings } from '@/lib/household'
import { translateIngredient, type WithIngredientTranslations } from '@/lib/i18n/content'
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales'
import { sameVaguePhrase } from '@/lib/i18n/vague-phrase'
import { prisma } from '@/lib/prisma'
import { MIXED_VAGUE_PHRASE } from '@/lib/vague-quantities'

import { getStartOfTodayInTimezone, toDateString } from './dates'
import { applyEntryChanges } from './entry-components'
import { pantryShoppingLines, shoppingIngredientArgs } from './pantry-shopping-lines'
import { cookServingsSelect, getCookServings } from './servings'

/**
 * Category configuration for shopping list grouping.
 * Order reflects typical grocery store layout.
 */
export const categoryConfig: Record<IngredientCategory, { label: string; order: number }> = {
  protein: { label: 'Proteins', order: 1 },
  vegetable: { label: 'Vegetables', order: 2 },
  fruit: { label: 'Fruits', order: 3 },
  dairy: { label: 'Dairy', order: 4 },
  carb: { label: 'Carbs & grains', order: 5 },
  legume: { label: 'Legumes', order: 6 },
  fat: { label: 'Oils & fats', order: 7 },
  condiment: { label: 'Condiments', order: 8 },
  spice: { label: 'Spices & seasonings', order: 9 },
}

/**
 * An individual item on the shopping list.
 */
export interface ShoppingListItem {
  ingredientId: string
  ingredient: {
    id: string
    name: string
    category: IngredientCategory
    defaultUnit: Unit
    gramsPerPiece: number | null
    measuredByVolume: boolean
    /** Shown as pieces (HON-1312). Absent reads as `none`. */
    pieceDisplay?: PieceDisplay
  }
  neededQuantity: number // Total needed for all planned meals
  pantryQuantity: number | null // What's in pantry (null = have some)
  shoppingQuantity: number // What to buy (0 = don't need)
  mealCount: number // Number of meals using this ingredient
  earliestNeededDate: Date // Earliest date this ingredient is needed
  isVague: boolean // True if any component contributing to this item was vague
  originalPhrase: string | null // The vague phrase if isVague is true
  /** A staple the household marked ran out (HON-1398). With `shoppingQuantity` 0, the line has no amount. */
  restock?: boolean
  /** Any other pantry row at 0, marked ran out (HON-1578). */
  ranOut?: boolean
}

/**
 * A needed ingredient the pantry covers, fully or in part (HON-1578). It
 * carries the pantry rows that keep it at home, so Today's "At home" tab can
 * switch them off: its own row first, then each other form of the herb that
 * covers it.
 */
export interface PantryCoveredItem {
  ingredientId: string
  ingredient: ShoppingListItem['ingredient']
  /** The part of the need the pantry covers: the need, or the pantry amount when it is less. */
  coveredQuantity: number
  earliestNeededDate: Date
  isVague: boolean
  originalPhrase: string | null
  pantryRows: { id: string; quantity: number | null }[]
  /** The first row is a staple. */
  isStaple: boolean
}

/**
 * Shopping list items grouped by ingredient category.
 */
export interface GroupedShoppingList {
  category: IngredientCategory
  categoryLabel: string
  items: ShoppingListItem[]
}

/**
 * One ingredient's total across the planned meals, before pantry deduction.
 */
export interface NeededIngredient {
  ingredient: {
    id: string
    name: string
    category: IngredientCategory
    defaultUnit: Unit
    gramsPerPiece: number | null
    measuredByVolume: boolean
    /** Shown as pieces (HON-1312). Absent reads as `none`. */
    pieceDisplay?: PieceDisplay
  }
  quantity: number
  mealCount: number
  earliestNeededDate: Date
  isVague: boolean // True if any component was vague
  originalPhrase: string | null // First vague phrase encountered
}

/**
 * Group shopping list items by category and sort by configured order.
 * Items within each category are sorted by earliest needed date.
 */
export function groupByCategory(items: ShoppingListItem[]): GroupedShoppingList[] {
  // Group items by category
  const grouped = new Map<IngredientCategory, ShoppingListItem[]>()

  for (const item of items) {
    const category = item.ingredient.category
    const existing = grouped.get(category)
    if (existing) {
      existing.push(item)
    } else {
      grouped.set(category, [item])
    }
  }

  // Convert to array and sort items within each category by earliest needed date
  const result: GroupedShoppingList[] = []
  for (const [category, categoryItems] of grouped) {
    result.push({
      category,
      categoryLabel: categoryConfig[category].label,
      items: categoryItems.sort(
        (a, b) => a.earliestNeededDate.getTime() - b.earliestNeededDate.getTime(),
      ),
    })
  }

  // Sort groups by category order
  result.sort((a, b) => categoryConfig[a.category].order - categoryConfig[b.category].order)

  return result
}

/**
 * One planned meal's contribution to a shopping list: the day it is cooked,
 * the servings it is cooked for, and its components.
 */
export interface AggregationEntry {
  date: Date
  servings: number
  components: readonly AggregationComponent[]
}

/** A meal component as the aggregation reads it. */
export type AggregationComponent = {
  ingredientId: string
  quantityPerServing: number
  isVague: boolean
  originalPhrase: string | null
  ingredient: WithIngredientTranslations<NeededIngredient['ingredient']>
}

/**
 * Sum each ingredient's quantity across the entries, before any pantry
 * deduction: `quantityPerServing × servings` per component, the number of
 * meals that use it, and the earliest day it is needed. A vague component
 * marks the whole item vague; two different vague phrases become "some".
 *
 * Pure, so the shopping list, the rolling window and the public sample weeks
 * (`src/lib/meal-plans/build-sample-week.ts`) all add up the same way.
 */
export function aggregateComponents(
  entries: readonly AggregationEntry[],
  locale: Locale,
): Map<string, NeededIngredient> {
  const needed = new Map<string, NeededIngredient>()

  for (const entry of entries) {
    for (const component of entry.components) {
      const ingredientId = component.ingredientId
      const qty = component.quantityPerServing * entry.servings
      const existing = needed.get(ingredientId)

      if (existing) {
        existing.quantity += qty
        existing.mealCount += 1
        // Track earliest date this ingredient is needed
        if (entry.date < existing.earliestNeededDate) {
          existing.earliestNeededDate = entry.date
        }
        // If any component is vague, mark the whole item as vague
        if (component.isVague) {
          if (!existing.isVague) {
            // First vague component encountered
            existing.isVague = true
            existing.originalPhrase = component.originalPhrase
          } else if (
            existing.originalPhrase !== MIXED_VAGUE_PHRASE &&
            !sameVaguePhrase(component.originalPhrase, existing.originalPhrase)
          ) {
            // Different vague phrase encountered - use "some" instead
            existing.originalPhrase = MIXED_VAGUE_PHRASE
          }
        }
      } else {
        needed.set(ingredientId, {
          ingredient: translateIngredient(component.ingredient, locale),
          quantity: qty,
          mealCount: 1,
          earliestNeededDate: entry.date,
          isVague: component.isVague,
          originalPhrase: component.originalPhrase,
        })
      }
    }
  }

  return needed
}

/**
 * The entry's own ingredient changes (HON-1243), merged over the meal's
 * components before aggregation, so a replaced cream buys yoghurt instead.
 */
function shoppingChangesArgs(locale: Locale) {
  return {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      originalIngredientId: true,
      replacementIngredientId: true,
      quantityPerServing: true,
      replacementIngredient: shoppingIngredientArgs(locale),
    },
  } as const
}

/**
 * Compute what ingredients to buy based on meal plan minus pantry stock.
 *
 * Algorithm:
 * 1. Get all planned entries for the meal plan (excludes completed, skipped)
 *    Also excludes meals before today (past meals don't need shopping)
 * 2. Aggregate ingredient quantities across all planned meals
 * 3. Compare against pantry stock
 * 4. Return grouped list of items to buy
 *
 * Pantry logic: `pantryShoppingLines` (a staple at 0 is a restock line)
 *
 * @param planId - The meal plan ID
 * @param householdId - The household ID for pantry lookup
 * @param householdTimezone - IANA timezone string for determining "today"
 * @returns Grouped shopping list sorted by category
 */
export async function computeShoppingList(
  planId: string,
  householdId: string,
  householdTimezone: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<GroupedShoppingList[]> {
  // Get start of today in household timezone to filter out past meals
  const startOfToday = getStartOfTodayInTimezone(householdTimezone)

  // Cap at 14 days ahead to avoid aggregating unbounded future entries
  // (with one plan per household, there's no natural weekly boundary)
  const endDate = new Date(startOfToday)
  endDate.setDate(endDate.getDate() + 14)

  // 1. Get entries for plan (only PLANNED status, within the 14-day window)
  const planEntries = await prisma.mealPlanEntry.findMany({
    where: {
      planId,
      status: 'planned',
      date: {
        gte: startOfToday,
        lt: endDate,
      },
    },
    select: {
      date: true,
      ...cookServingsSelect,
      changes: shoppingChangesArgs(locale),
      meal: {
        include: {
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
      },
    },
  })

  // 2. Get the household's servings (its members' portions) for the quantities
  const householdServings = await loadHouseholdServings(householdId)

  // 3. Aggregate quantities per ingredient. An entry without a meal (an
  // eating_out entry before its status change) contributes nothing.
  const needed = aggregateComponents(
    planEntries.flatMap((entry) =>
      entry.meal
        ? [
            {
              date: entry.date,
              servings: getCookServings(entry, householdServings),
              components: applyEntryChanges(entry.meal.components, entry.changes),
            },
          ]
        : [],
    ),
    locale,
  )

  // 4. Deduct the pantry (staples, ran-out items) from the need
  const { lines } = await pantryShoppingLines(needed, householdId, locale, startOfToday)

  // 5. Group by category
  return groupByCategory(lines)
}

/**
 * Result of computing a rolling window shopping list.
 */
export interface RollingWindowResult {
  groups: GroupedShoppingList[]
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  windowDays: number
  earliestPlanCreatedAt: Date | null // For purchase tracking
  /**
   * Whether the household has any meal plan entry dated today or later, in any
   * status. Unlike `earliestPlanCreatedAt`, which is null whenever the window
   * holds no planned entries, this answers "does this household have a plan?"
   * — so a household whose entries fall past the window is not told it has none.
   * Past entries are excluded: they are never deleted, so counting them would
   * keep a lapsed household away from "Generate plan" for good. A day extra
   * from today on counts as a plan too (HON-1309).
   */
  hasAnyPlan: boolean
  /** The needed ingredients the pantry covers, in no order (HON-1578). */
  atHome: PantryCoveredItem[]
}

/**
 * Compute shopping list for a rolling window from today.
 *
 * Unlike computeShoppingList which is tied to a single plan, this function
 * queries across all meal plans that overlap with the date window, aggregating
 * ingredients from any planned meals within the window.
 *
 * @param householdId - The household ID
 * @param days - Number of days in the window (7 or 14)
 * @param householdTimezone - IANA timezone string for determining "today"
 * @param locale - Resolved household locale (`resolveHouseholdLocale`); ingredient names are translated when non-default
 * @returns Grouped shopping list with window metadata
 */
export async function computeRollingWindowShoppingList(
  householdId: string,
  days: number,
  householdTimezone: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<RollingWindowResult> {
  // Get start of today in household timezone
  const startOfToday = getStartOfTodayInTimezone(householdTimezone)

  // Calculate end date (exclusive) - days from today
  const endDate = new Date(startOfToday)
  endDate.setDate(endDate.getDate() + days)

  // 1. Get all entries across any plans for this household within the window
  // Only PLANNED status, today through endDate (exclusive). Alongside it, count
  // every entry from today on, in any status and past the window, for `hasAnyPlan`.
  // The day extras (HON-1309) are read the same way: the window's ingredient
  // extras, and a count of every extra from today on.
  const inWindow = { gte: startOfToday, lt: endDate }
  const [planEntries, totalEntryCount, extras, totalExtraCount] = await Promise.all([
    prisma.mealPlanEntry.findMany({
      where: {
        plan: {
          householdId,
        },
        status: 'planned',
        date: inWindow,
      },
      select: {
        date: true,
        ...cookServingsSelect,
        changes: shoppingChangesArgs(locale),
        plan: {
          select: {
            createdAt: true,
          },
        },
        meal: {
          include: {
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
        },
      },
    }),
    prisma.mealPlanEntry.count({
      where: { plan: { householdId }, date: { gte: startOfToday } },
    }),
    prisma.dayExtra.findMany({
      where: { householdId, ingredientId: { not: null }, date: inWindow },
      select: {
        date: true,
        quantity: true,
        createdAt: true,
        ingredient: shoppingIngredientArgs(locale),
      },
    }),
    prisma.dayExtra.count({ where: { householdId, date: { gte: startOfToday } } }),
  ])

  // Track earliest plan creation date for purchase tracking. An extra counts
  // too, so a window that holds only extras can show a line as purchased.
  let earliestPlanCreatedAt: Date | null = null
  for (const createdAt of [
    ...planEntries.map((entry) => entry.plan.createdAt),
    ...extras.map((extra) => extra.createdAt),
  ]) {
    if (!earliestPlanCreatedAt || createdAt < earliestPlanCreatedAt) {
      earliestPlanCreatedAt = createdAt
    }
  }

  // 2. Get the household's servings (its members' portions) for the quantities
  const householdServings = await loadHouseholdServings(householdId)

  // 3. Aggregate quantities per ingredient. An entry without a meal (an
  // eating_out entry before its status change) contributes nothing.
  const needed = aggregateComponents(
    [
      ...planEntries.flatMap((entry): AggregationEntry[] =>
        entry.meal
          ? [
              {
                date: entry.date,
                servings: getCookServings(entry, householdServings),
                components: applyEntryChanges(entry.meal.components, entry.changes),
              },
            ]
          : [],
      ),
      // The ingredient extras (HON-1309) merge with the meals' need here.
      ...extraAggregationEntries(extras),
    ],
    locale,
  )

  // 4. Deduct the pantry (staples, ran-out items) from the need
  const { lines, atHome } = await pantryShoppingLines(needed, householdId, locale, startOfToday)

  // Calculate actual end date for display (last day of window, inclusive)
  const displayEndDate = new Date(startOfToday)
  displayEndDate.setDate(displayEndDate.getDate() + days - 1)

  // 5. Group by category and return with metadata
  return {
    groups: groupByCategory(lines),
    startDate: toDateString(startOfToday),
    endDate: toDateString(displayEndDate),
    windowDays: days,
    earliestPlanCreatedAt,
    hasAnyPlan: totalEntryCount + totalExtraCount > 0,
    atHome,
  }
}
