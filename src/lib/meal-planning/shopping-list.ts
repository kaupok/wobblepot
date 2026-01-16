import { prisma } from '@/lib/prisma'
import { IngredientCategory, Unit } from '@/generated/prisma/enums'

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
 * @returns Grouped shopping list sorted by category
 */
export async function computeShoppingList(
  planId: string,
  householdId: string,
): Promise<GroupedShoppingList[]> {
  // 1. Get all entries for plan (only PLANNED status)
  const planEntries = await prisma.mealPlanEntry.findMany({
    where: {
      planId,
      status: 'planned',
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
