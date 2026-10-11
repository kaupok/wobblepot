import 'server-only'
import { z } from 'zod'
import { loadShoppingList } from '@/lib/shopping/load-shopping-list'
import { defineTool } from '@/lib/mcp/context'

export const getShoppingList = defineTool({
  name: 'get_shopping_list',
  title: 'Get shopping list',
  description:
    'Returns what the household needs to buy for its planned meals in the next 7 or 14 days, plus the items it added by hand. Use it to answer whether to buy something, or what to get at the shop. An item marked purchased is already in the pantry.',
  inputSchema: z.object({
    days: z
      .union([z.literal(7), z.literal(14)])
      .default(7)
      .describe('How many days of planned meals to shop for: 7 or 14.'),
  }),
  outputSchema: z.object({
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
      }),
    ),
    customItems: z.array(z.object({ id: z.string(), name: z.string(), checked: z.boolean() })),
  }),
  run: async (household, { days }) => {
    const list = await loadShoppingList(household, { days })
    return {
      days,
      items: list.groups.flatMap((group) =>
        group.items.map((item) => ({
          ingredientId: item.ingredientId,
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          displayQuantity: item.displayQuantity,
          category: group.category,
          neededBy: item.neededByDate,
          purchased: item.purchased,
        })),
      ),
      customItems: list.customItems.map((item) => ({
        id: item.id,
        name: item.name,
        checked: item.checked,
      })),
    }
  },
})
