import 'server-only'
import { getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { computeRollingWindowShoppingList } from '@/lib/meal-planning/shopping-list'
import { toDateString, parseLocalDate, getTodayInTimezone } from '@/lib/meal-planning/dates'
import {
  calendarDaysBetween,
  formatRelativeDate,
  formatAbsoluteDate,
} from '@/lib/i18n/format-dates'
import { formatShoppingQuantity } from '@/lib/i18n/format-shopping-quantity'
import type { Locale } from '@/lib/i18n/locales'

export interface ShoppingListHousehold {
  id: string
  locale: string
  timezone: string
}

export type ShoppingListResult = Awaited<ReturnType<typeof loadShoppingList>>

/**
 * The household's shopping list for a rolling window of `days` from today, in
 * the shape `GET /api/shopping-list` returns. The route, `/shopping`, `/pantry`
 * and the Today page all read through this (HON-789).
 *
 * `locale` is the request locale (`getLocale()`), which formats quantities and
 * dates; the caller resolves it so this function stays free of request state
 * beyond the `dates` translator.
 */
export async function loadShoppingList(
  household: ShoppingListHousehold,
  { days, locale }: { days: 7 | 14; locale: Locale },
) {
  // Compute rolling window shopping list and fetch custom items in parallel
  const [result, pantryItems, customItems, tDates, tVague] = await Promise.all([
    computeRollingWindowShoppingList(household.id, days, household.timezone, household.locale),
    prisma.pantryItem.findMany({
      where: { householdId: household.id },
      select: {
        ingredientId: true,
        updatedAt: true,
      },
    }),
    prisma.customShoppingItem.findMany({
      where: { householdId: household.id },
      include: {
        ingredient: {
          select: { id: true, name: true, category: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    getTranslations({ locale, namespace: 'dates' }),
    getTranslations({ locale, namespace: 'enums.VaguePhrase' }),
  ])

  const pantryMap = new Map(pantryItems.map((p) => [p.ingredientId, p]))

  // The reference for "today" is the household's local day, not the server's,
  // so a household in Europe/Tallinn at 23:30 local sees the right label
  // even when the server clock is in a different timezone.
  const todayInTz = parseLocalDate(getTodayInTimezone(household.timezone))

  // Transform to response format with display quantities and purchase status
  let totalItems = 0
  let purchasedItems = 0

  const groups = result.groups.map((group) => {
    // Map items with purchase status and needed-by date
    const mappedItems = group.items.map((item) => {
      const pantryItem = pantryMap.get(item.ingredientId)
      // Item is purchased if it exists in pantry and was updated after earliest plan was created
      // If no plans in window, nothing can be purchased
      const purchased =
        pantryItem && result.earliestPlanCreatedAt
          ? pantryItem.updatedAt >= result.earliestPlanCreatedAt
          : false

      totalItems++
      if (purchased) purchasedItems++

      return {
        ingredientId: item.ingredientId,
        name: item.ingredient.name,
        quantity: item.shoppingQuantity,
        unit: item.ingredient.defaultUnit,
        displayQuantity: formatShoppingQuantity(
          item.shoppingQuantity,
          item.ingredient.defaultUnit,
          locale,
          item.isVague,
          item.originalPhrase,
          tVague,
        ),
        mealCount: item.mealCount,
        purchased,
        neededByDate: toDateString(item.earliestNeededDate),
        neededByRelative: formatRelativeDate(item.earliestNeededDate, locale, tDates, {
          referenceDate: todayInTz,
          timeZone: household.timezone,
        }),
        neededByAbsolute: formatAbsoluteDate(item.earliestNeededDate, locale, {
          timeZone: household.timezone,
        }),
        // Same reference day as `neededByRelative`, so the warning colour and
        // the "Today" label cannot disagree (HON-762). Overdue counts as today.
        dueToday: calendarDaysBetween(todayInTz, item.earliestNeededDate, household.timezone) <= 0,
        // Same condition as `formatShoppingQuantity`: true only when
        // `displayQuantity` is the phrase, not a formatted amount (HON-783).
        isVague: item.isVague && !!item.originalPhrase,
      }
    })

    // Sort items: unpurchased by date ASC, then purchased at bottom
    mappedItems.sort((a, b) => {
      // Purchased items go to bottom
      if (a.purchased !== b.purchased) {
        return a.purchased ? 1 : -1
      }
      // Within same purchase status, sort by date (earliest first)
      return a.neededByDate.localeCompare(b.neededByDate)
    })

    return {
      category: group.category,
      categoryLabel: group.categoryLabel,
      items: mappedItems,
    }
  })

  // Format custom items for response
  const formattedCustomItems = customItems.map((item) => ({
    id: item.id,
    name: item.name,
    checked: item.checked,
    ingredientId: item.ingredientId,
    ingredientCategory: item.ingredient?.category ?? null,
    createdAt: item.createdAt.toISOString(),
  }))

  return {
    windowDays: days,
    startDate: result.startDate,
    endDate: result.endDate,
    generatedAt: result.earliestPlanCreatedAt?.toISOString() ?? null,
    hasAnyPlan: result.hasAnyPlan,
    groups,
    customItems: formattedCustomItems,
    summary: {
      totalItems,
      purchasedItems,
      remainingItems: totalItems - purchasedItems,
    },
  }
}
