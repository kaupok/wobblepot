import 'server-only'
import { z } from 'zod'
import {
  ingredientIdsSchema,
  purchaseIngredients,
  UNPURCHASE_WINDOW_DAYS,
  unpurchaseIngredient,
} from '@/lib/shopping/purchase'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'

/** One call marks at most this many items, so a transaction stays short. */
const MAX_INGREDIENTS = 100

export const markPurchased = defineTool({
  name: 'mark_purchased',
  title: 'Mark purchased',
  description: `Marks items from the shopping list as bought, or undoes that. A bought item goes into the pantry, so it drops off the shopping list. Pass the ingredientId values from get_shopping_list; for items the household added by hand, use check_shopping_item. Undoing takes the item back out of the pantry. That works only within ${UNPURCHASE_WINDOW_DAYS} days of the purchase and never for a staple; the result says so for each item.`,
  annotations: WRITE_ANNOTATIONS,
  inputSchema: z.object({
    ingredientIds: ingredientIdsSchema
      .max(MAX_INGREDIENTS)
      .describe('The ingredientId of each shopping list item, from get_shopping_list.'),
    purchased: z.boolean().describe('true when the items were bought, false to undo that.'),
  }),
  outputSchema: z.object({
    purchased: z.boolean(),
    items: z.array(
      z.object({
        ingredientId: z.string(),
        outcome: z
          .enum(['in_pantry', 'removed', 'not_in_pantry', 'staple', 'too_old'])
          .describe(
            `in_pantry: bought and in the pantry. removed: taken back out of the pantry. not_in_pantry: it was not in the pantry. staple: a staple stays in the pantry. too_old: it was bought more than ${UNPURCHASE_WINDOW_DAYS} days ago, so it stays.`,
          ),
      }),
    ),
  }),
  run: async (household, { ingredientIds, purchased }) => {
    const uniqueIds = [...new Set(ingredientIds)]

    if (purchased) {
      const outcome = await purchaseIngredients(household, uniqueIds)
      if (outcome.status === 'invalid_ids') {
        throw new ToolInputError(
          `Wobblepot has no ingredient with these ids: ${outcome.invalidIds.join(', ')}. Use the ingredientId values from get_shopping_list. Nothing was changed.`,
        )
      }
      return {
        purchased,
        items: outcome.results.map(({ ingredientId }) => ({
          ingredientId,
          outcome: 'in_pantry' as const,
        })),
      }
    }

    // One at a time, as the app undoes them: each is its own small change.
    const items = []
    for (const ingredientId of uniqueIds) {
      items.push({ ingredientId, outcome: await unpurchaseIngredient(household.id, ingredientId) })
    }
    return { purchased, items }
  },
})
