import { prisma } from '@/lib/prisma'
import { IngredientCategory, Unit } from '@/generated/prisma/enums'
import { getStartOfTodayInTimezone, toDateString } from './dates'

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
 * Default household size when no household preferences exist.
 */
const DEFAULT_HOUSEHOLD_SIZE = 2

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
  }
  neededQuantity: number // Total needed for all planned meals
  pantryQuantity: number | null // What's in pantry (null = have some)
  shoppingQuantity: number // What to buy (0 = don't need)
  mealCount: number // Number of meals using this ingredient
  earliestNeededDate: Date // Earliest date this ingredient is needed
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
 * Internal type for tracking needed ingredients during aggregation.
 */
interface NeededIngredient {
  ingredient: {
    id: string
    name: string
    category: IngredientCategory
    defaultUnit: Unit
    gramsPerPiece: number | null
  }
  quantity: number
  mealCount: number
  earliestNeededDate: Date
}

/**
 * Get household size from member count.
 * Returns default size if no household found or no members.
 */
async function getHouseholdSize(householdId: string): Promise<number> {
  const memberCount = await prisma.householdMember.count({
    where: { householdId },
  })
  return memberCount > 0 ? memberCount : DEFAULT_HOUSEHOLD_SIZE
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
 * Compute what ingredients to buy based on meal plan minus pantry stock.
 *
 * Algorithm:
 * 1. Get all planned entries for the meal plan (excludes completed, skipped, eating_out)
 *    Also excludes meals before today (past meals don't need shopping)
 * 2. Aggregate ingredient quantities across all planned meals
 * 3. Compare against pantry stock
 * 4. Return grouped list of items to buy
 *
 * Pantry logic:
 * - Staple items: Skip entirely (always in stock)
 * - quantity = null: Skip (assume sufficient stock)
 * - quantity = 0: Need full amount (ran out)
 * - quantity > 0: Calculate difference
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
): Promise<GroupedShoppingList[]> {
  // Get start of today in household timezone to filter out past meals
  const startOfToday = getStartOfTodayInTimezone(householdTimezone)

  // 1. Get all entries for plan (only PLANNED status, today or future)
  const planEntries = await prisma.mealPlanEntry.findMany({
    where: {
      planId,
      status: 'planned',
      date: {
        gte: startOfToday,
      },
    },
    include: {
      meal: {
        include: {
          components: {
            include: {
              ingredient: {
                select: {
                  id: true,
                  name: true,
                  category: true,
                  defaultUnit: true,
                  gramsPerPiece: true,
                },
              },
            },
          },
        },
      },
    },
  })

  // 2. Get household size for quantity calculation
  const householdSize = await getHouseholdSize(householdId)

  // 3. Aggregate quantities per ingredient
  const needed = new Map<string, NeededIngredient>()

  for (const entry of planEntries) {
    // Skip entries without a meal (e.g., eating_out entries before status change)
    if (!entry.meal) continue

    for (const component of entry.meal.components) {
      const ingredientId = component.ingredientId
      const qty = component.quantityPerServing * householdSize
      const existing = needed.get(ingredientId)

      if (existing) {
        existing.quantity += qty
        existing.mealCount += 1
        // Track earliest date this ingredient is needed
        if (entry.date < existing.earliestNeededDate) {
          existing.earliestNeededDate = entry.date
        }
      } else {
        needed.set(ingredientId, {
          ingredient: component.ingredient,
          quantity: qty,
          mealCount: 1,
          earliestNeededDate: entry.date,
        })
      }
    }
  }

  // 4. Get pantry items
  const pantryItems = await prisma.pantryItem.findMany({
    where: { householdId },
  })
  const pantryMap = new Map(pantryItems.map((p) => [p.ingredientId, p]))

  // 5. Calculate shopping quantities
  const shoppingList: ShoppingListItem[] = []

  for (const [
    ingredientId,
    { ingredient, quantity: neededQty, mealCount, earliestNeededDate },
  ] of needed) {
    const pantry = pantryMap.get(ingredientId)

    let shoppingQty: number

    if (pantry?.isStaple) {
      // Staple - always skip (don't include in list at all)
      continue
    } else if (!pantry) {
      // Not in pantry - need full amount
      shoppingQty = neededQty
    } else if (pantry.quantity === null) {
      // Have some, assume sufficient
      shoppingQty = 0
    } else if (pantry.quantity === 0) {
      // Ran out - need full amount
      shoppingQty = neededQty
    } else {
      // Have partial - calculate difference
      shoppingQty = Math.max(0, neededQty - pantry.quantity)
    }

    // Only include if need to buy something
    if (shoppingQty > 0) {
      shoppingList.push({
        ingredientId,
        ingredient,
        neededQuantity: neededQty,
        pantryQuantity: pantry?.quantity ?? null,
        shoppingQuantity: shoppingQty,
        mealCount,
        earliestNeededDate,
      })
    }
  }

  // 6. Group by category
  return groupByCategory(shoppingList)
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
 * @returns Grouped shopping list with window metadata
 */
export async function computeRollingWindowShoppingList(
  householdId: string,
  days: number,
  householdTimezone: string,
): Promise<RollingWindowResult> {
  // Get start of today in household timezone
  const startOfToday = getStartOfTodayInTimezone(householdTimezone)

  // Calculate end date (exclusive) - days from today
  const endDate = new Date(startOfToday)
  endDate.setDate(endDate.getDate() + days)

  // 1. Get all entries across any plans for this household within the window
  // Only PLANNED status, today through endDate (exclusive)
  const planEntries = await prisma.mealPlanEntry.findMany({
    where: {
      plan: {
        householdId,
      },
      status: 'planned',
      date: {
        gte: startOfToday,
        lt: endDate,
      },
    },
    include: {
      plan: {
        select: {
          createdAt: true,
        },
      },
      meal: {
        include: {
          components: {
            include: {
              ingredient: {
                select: {
                  id: true,
                  name: true,
                  category: true,
                  defaultUnit: true,
                  gramsPerPiece: true,
                },
              },
            },
          },
        },
      },
    },
  })

  // Track earliest plan creation date for purchase tracking
  let earliestPlanCreatedAt: Date | null = null
  for (const entry of planEntries) {
    if (!earliestPlanCreatedAt || entry.plan.createdAt < earliestPlanCreatedAt) {
      earliestPlanCreatedAt = entry.plan.createdAt
    }
  }

  // 2. Get household size for quantity calculation
  const householdSize = await getHouseholdSize(householdId)

  // 3. Aggregate quantities per ingredient
  const needed = new Map<string, NeededIngredient>()

  for (const entry of planEntries) {
    // Skip entries without a meal (e.g., eating_out entries before status change)
    if (!entry.meal) continue

    for (const component of entry.meal.components) {
      const ingredientId = component.ingredientId
      const qty = component.quantityPerServing * householdSize
      const existing = needed.get(ingredientId)

      if (existing) {
        existing.quantity += qty
        existing.mealCount += 1
        // Track earliest date this ingredient is needed
        if (entry.date < existing.earliestNeededDate) {
          existing.earliestNeededDate = entry.date
        }
      } else {
        needed.set(ingredientId, {
          ingredient: component.ingredient,
          quantity: qty,
          mealCount: 1,
          earliestNeededDate: entry.date,
        })
      }
    }
  }

  // 4. Get pantry items
  const pantryItems = await prisma.pantryItem.findMany({
    where: { householdId },
  })
  const pantryMap = new Map(pantryItems.map((p) => [p.ingredientId, p]))

  // 5. Calculate shopping quantities
  const shoppingList: ShoppingListItem[] = []

  for (const [
    ingredientId,
    { ingredient, quantity: neededQty, mealCount, earliestNeededDate },
  ] of needed) {
    const pantry = pantryMap.get(ingredientId)

    let shoppingQty: number

    if (pantry?.isStaple) {
      // Staple - always skip (don't include in list at all)
      continue
    } else if (!pantry) {
      // Not in pantry - need full amount
      shoppingQty = neededQty
    } else if (pantry.quantity === null) {
      // Have some, assume sufficient
      shoppingQty = 0
    } else if (pantry.quantity === 0) {
      // Ran out - need full amount
      shoppingQty = neededQty
    } else {
      // Have partial - calculate difference
      shoppingQty = Math.max(0, neededQty - pantry.quantity)
    }

    // Only include if need to buy something
    if (shoppingQty > 0) {
      shoppingList.push({
        ingredientId,
        ingredient,
        neededQuantity: neededQty,
        pantryQuantity: pantry?.quantity ?? null,
        shoppingQuantity: shoppingQty,
        mealCount,
        earliestNeededDate,
      })
    }
  }

  // Calculate actual end date for display (last day of window, inclusive)
  const displayEndDate = new Date(startOfToday)
  displayEndDate.setDate(displayEndDate.getDate() + days - 1)

  // 6. Group by category and return with metadata
  return {
    groups: groupByCategory(shoppingList),
    startDate: toDateString(startOfToday),
    endDate: toDateString(displayEndDate),
    windowDays: days,
    earliestPlanCreatedAt,
  }
}
