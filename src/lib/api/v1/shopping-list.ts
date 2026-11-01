import 'server-only'

import { z } from 'zod'

import type { McpHousehold } from '@/lib/mcp/context'
import { loadShoppingList } from '@/lib/shopping/load-shopping-list'

/**
 * What the household needs to buy: the body of the `get_shopping_list` MCP
 * tool and of `GET /api/v1/shopping-list` (HON-1220).
 */

export const shoppingListInputSchema = z.object({
  days: z
    .union([z.literal(7), z.literal(14)])
    .default(7)
    .describe('How many days of planned meals to shop for: 7 or 14.'),
})

export const shoppingListOutputSchema = z.object({
  days: z.number(),
  items: z.array(
    z.object({
      ingredientId: z.string(),
      name: z.string(),
      quantity: z.number(),
      unit: z.string(),
      displayQuantity: z.string(),
      category: z.string(),
      neededBy: z.iso.date(),
      purchased: z.boolean(),
      restock: z
        .boolean()
        .describe(
          'true when the item is a staple the household marked ran out; such a line can have no amount (quantity 0, displayQuantity empty).',
        ),
    }),
  ),
  // `neededBy` is the earliest day of a linked free-text extra from today on
  // (HON-1310); null for an item typed by hand.
  customItems: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      checked: z.boolean(),
      neededBy: z.iso.date().nullable(),
    }),
  ),
  // The "have some" items two or more planned meals use (HON-1584). They are
  // not on `items`: the list assumes the pantry has enough.
  check: z.array(
    z.object({
      ingredientId: z.string(),
      name: z.string(),
      quantity: z.number().describe("The window's whole need, in `unit`."),
      unit: z.string(),
      displayQuantity: z.string(),
      mealCount: z.number(),
      neededBy: z.iso.date().describe('The first day a planned meal needs it.'),
      isStaple: z.boolean(),
    }),
  ),
})

export async function readShoppingList(
  household: McpHousehold,
  { days }: z.output<typeof shoppingListInputSchema>,
): Promise<z.output<typeof shoppingListOutputSchema>> {
  const list = await loadShoppingList(household, { days })
  return {
    days,
    items: list.groups.flatMap((group) =>
      group.items.map((item) => ({
        ingredientId: item.ingredientId,
        name: item.name,
        quantity: item.quantity,
        unit: item.displayUnit,
        displayQuantity: item.displayQuantity,
        category: group.category,
        neededBy: item.neededByDate,
        purchased: item.purchased,
        restock: item.restock,
      })),
    ),
    customItems: list.customItems.map((item) => ({
      id: item.id,
      name: item.name,
      checked: item.checked,
      neededBy: item.neededBy,
    })),
    check: list.check.map((item) => ({
      ingredientId: item.ingredientId,
      name: item.name,
      quantity: item.quantity,
      unit: item.displayUnit,
      displayQuantity: item.displayQuantity,
      mealCount: item.mealCount,
      neededBy: item.neededByDate,
      isStaple: item.isStaple,
    })),
  }
}
