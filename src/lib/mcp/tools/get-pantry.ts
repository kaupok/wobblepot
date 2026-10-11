import 'server-only'
import { z } from 'zod'
import { loadPantry } from '@/lib/meal-planning/load-pantry'
import { defineTool } from '@/lib/mcp/context'

/** "Needed soon" means a planned meal in this many days uses the item. */
const NEEDED_SOON_DAYS = 7

export const getPantry = defineTool({
  name: 'get_pantry',
  title: 'Get pantry',
  description:
    'Returns what the household has at home, with the amount when it is known. Use it to answer whether there is enough of something, or what can be cooked from what is in stock. quantity null means "have some, amount unknown"; 0 means it ran out.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    items: z.array(
      z.object({
        ingredientId: z.string(),
        name: z.string(),
        quantity: z.number().nullable(),
        unit: z.string(),
        isStaple: z.boolean(),
        neededSoon: z.boolean(),
      }),
    ),
  }),
  run: async (household) => {
    const { items } = await loadPantry(household, { days: NEEDED_SOON_DAYS })
    return {
      items: items.map((item) => ({
        ingredientId: item.ingredientId,
        name: item.ingredient.name,
        quantity: item.quantity,
        unit: item.ingredient.defaultUnit,
        isStaple: item.isStaple,
        // `loadPantry` sets `neededQuantity` only for an item a planned meal in
        // the window uses.
        neededSoon: 'neededQuantity' in item,
      })),
    }
  },
})
