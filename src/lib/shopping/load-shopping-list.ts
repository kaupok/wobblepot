import 'server-only'
import { getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import {
  computeRollingWindowShoppingList,
  computeShoppingList,
} from '@/lib/meal-planning/shopping-list'
import { toDateString, parseLocalDate, getTodayInTimezone } from '@/lib/meal-planning/dates'
import {
  calendarDaysBetween,
  formatRelativeDate,
  formatAbsoluteDate,
} from '@/lib/i18n/format-dates'
import { displayUnit, formatShoppingQuantity } from '@/lib/i18n/format-shopping-quantity'
import { formatShoppingLineQuantity } from '@/lib/i18n/format-piece-quantity'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'

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
 * Item names, quantities and dates all follow the household's resolved locale,
 * so one response cannot mix two languages when the household's stored locale
 * and the request locale disagree (a locale rolled back out of `KNOWN_LOCALES`,
 * HON-921). The `dates` and `VaguePhrase` translators take that locale
 * explicitly, as does the `Unit` one that labels piece counts, so nothing here
 * re-reads the session.
 */
export async function loadShoppingList(
  household: ShoppingListHousehold,
  { days }: { days: 7 | 14 },
) {
  const locale = resolveHouseholdLocale(household)
  // Compute rolling window shopping list and fetch custom items in parallel
  const [result, pantryItems, customItems, tDates, tVague, tUnit] = await Promise.all([
    computeRollingWindowShoppingList(household.id, days, household.timezone, locale),
    prisma.pantryItem.findMany({
      where: { householdId: household.id },
      select: {
        ingredientId: true,
        quantity: true,
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
    getTranslations({ locale, namespace: 'enums.Unit' }),
  ])
  const pieceLabel = tUnit('piece')

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
      // Item is purchased if its pantry quantity is null ("have some") and was
      // set after the earliest plan was created. If no plans in window, nothing
      // can be purchased. A purchase always sets null (`purchaseIngredients`),
      // so a 0 or a quantity above 0 was set on the pantry page, through the
      // pantry API or with `set_pantry_status`, and is not a purchase
      // (HON-1173, HON-1176, HON-1201).
      // `computeRollingWindowShoppingList` drops a null item today, so a listed
      // item does not read as purchased: a bought item leaves the list. The
      // condition stays so that an edit can never read as a purchase if the
      // list starts to keep bought items.
      const purchased =
        pantryItem && result.earliestPlanCreatedAt
          ? pantryItem.quantity === null && pantryItem.updatedAt >= result.earliestPlanCreatedAt
          : false

      totalItems++
      if (purchased) purchasedItems++

      return {
        ingredientId: item.ingredientId,
        name: item.ingredient.name,
        quantity: item.shoppingQuantity,
        unit: item.ingredient.defaultUnit,
        // `g`, `ml` or `piece`: `unit` stays the stored unit, and this is the one
        // every screen shows, so readers outside the UI (the MCP tools, HON-1151)
        // need not repeat the `measuredByVolume` rule.
        displayUnit: displayUnit(item.ingredient),
        displayQuantity: formatShoppingLineQuantity(
          item.shoppingQuantity,
          item.ingredient,
          locale,
          item.isVague,
          item.originalPhrase,
          tVague,
          pieceLabel,
        ),
        // The same need in the pantry screen's units, which stay in grams
        // (HON-1312): a ticked item hands it to the pantry's "needed" caption,
        // which then matches `load-pantry.ts` after a reload.
        pantryDisplayQuantity: formatShoppingQuantity(
          item.shoppingQuantity,
          displayUnit(item.ingredient),
          locale,
          item.isVague,
          item.originalPhrase,
          tVague,
          pieceLabel,
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

/**
 * Why a plan-scoped shopping list function refused. The routes map each one to
 * its status:
 *
 * - `planNotFound`: no plan has this id (404).
 * - `otherHousehold`: the plan belongs to another household (403).
 */
export type ShoppingPlanRefusal = 'planNotFound' | 'otherHousehold'

export class ShoppingPlanError extends Error {
  constructor(readonly reason: ShoppingPlanRefusal) {
    super(`Shopping list plan refused: ${reason}`)
    this.name = 'ShoppingPlanError'
  }
}

/**
 * The household's plan with this id. Throws `ShoppingPlanError` for a plan that
 * does not exist or is another household's. Shared by `loadPlanShoppingList`
 * and the plan-scoped purchase and unpurchase in `./purchase`.
 */
export async function findHouseholdPlan(householdId: string, planId: string) {
  const plan = await prisma.mealPlan.findUnique({
    where: { id: planId },
    select: { id: true, householdId: true, createdAt: true },
  })

  if (!plan) throw new ShoppingPlanError('planNotFound')
  if (plan.householdId !== householdId) throw new ShoppingPlanError('otherHousehold')

  return plan
}

export type PlanShoppingListResult = Awaited<ReturnType<typeof loadPlanShoppingList>>

/**
 * One plan's shopping list, in the shape `GET /api/meal-plans/[id]/shopping-list`
 * returns (HON-1208). Meals before the household's today are left out. Names,
 * quantities and dates follow the household's resolved locale, as in
 * `loadShoppingList`. Throws `ShoppingPlanError` for a plan that does not exist
 * or is another household's.
 */
export async function loadPlanShoppingList(household: ShoppingListHousehold, planId: string) {
  const plan = await findHouseholdPlan(household.id, planId)
  const locale = resolveHouseholdLocale(household)

  const [groupedList, pantryItems, tDates, tVague, tUnit] = await Promise.all([
    computeShoppingList(plan.id, household.id, household.timezone, locale),
    prisma.pantryItem.findMany({
      where: { householdId: household.id },
      select: {
        ingredientId: true,
        quantity: true,
        updatedAt: true,
      },
    }),
    getTranslations({ locale, namespace: 'dates' }),
    getTranslations({ locale, namespace: 'enums.VaguePhrase' }),
    getTranslations({ locale, namespace: 'enums.Unit' }),
  ])
  const pieceLabel = tUnit('piece')
  const pantryMap = new Map(pantryItems.map((p) => [p.ingredientId, p]))

  // The household's local day, not the server's, as in `loadShoppingList`.
  const todayInTz = parseLocalDate(getTodayInTimezone(household.timezone))

  let totalItems = 0
  let purchasedItems = 0

  const groups = groupedList.map((group) => {
    const mappedItems = group.items.map((item) => {
      const pantryItem = pantryMap.get(item.ingredientId)
      // Purchased if its pantry quantity is null ("have some") and was set
      // after the plan was created. A purchase always sets null, so any other
      // quantity is not a purchase, as in `loadShoppingList` (HON-1173,
      // HON-1176). `computeShoppingList` drops a null item today, so a listed
      // item does not read as purchased; see `loadShoppingList` for why the
      // condition stays.
      const purchased = pantryItem
        ? pantryItem.quantity === null && pantryItem.updatedAt >= plan.createdAt
        : false

      totalItems++
      if (purchased) purchasedItems++

      return {
        ingredientId: item.ingredientId,
        name: item.ingredient.name,
        quantity: item.shoppingQuantity,
        unit: item.ingredient.defaultUnit,
        displayQuantity: formatShoppingLineQuantity(
          item.shoppingQuantity,
          item.ingredient,
          locale,
          item.isVague,
          item.originalPhrase,
          tVague,
          pieceLabel,
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
        // Same reference day as `neededByRelative` (HON-762).
        dueToday: calendarDaysBetween(todayInTz, item.earliestNeededDate, household.timezone) <= 0,
        isVague: item.isVague,
      }
    })

    // Unpurchased first, each part by date (earliest first)
    mappedItems.sort((a, b) => {
      if (a.purchased !== b.purchased) {
        return a.purchased ? 1 : -1
      }
      return a.neededByDate.localeCompare(b.neededByDate)
    })

    return {
      category: group.category,
      categoryLabel: group.categoryLabel,
      items: mappedItems,
    }
  })

  return {
    planId: plan.id,
    generatedAt: plan.createdAt.toISOString(),
    groups,
    summary: {
      totalItems,
      purchasedItems,
      remainingItems: totalItems - purchasedItems,
    },
  }
}
