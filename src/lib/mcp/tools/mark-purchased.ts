import 'server-only'

import { z } from 'zod'

import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import {
  ingredientIdsSchema,
  purchaseIngredients,
  UNPURCHASE_WINDOW_DAYS,
  unpurchaseIngredient,
} from '@/lib/shopping/purchase'

/** One call marks at most this many items, so a transaction stays short. */
const MAX_INGREDIENTS = 100

export const markPurchased = defineTool({
  name: 'mark_purchased',
  title: 'Mark purchased',
  description: `Marks items from the shopping list as bought, or undoes that. A bought item goes into the pantry as "have some", replacing any quantity the pantry had for it, so it drops off the shopping list. Pass the ingredientId values from get_shopping_list; for items the household added by hand, use check_shopping_item. Undoing takes the item back out of the pantry; a staple stays a staple and goes back to ran out, so it is on the shopping list again. That works only within ${UNPURCHASE_WINDOW_DAYS} days of the purchase, and never for a pantry item with a quantity the household entered after the purchase; the result says so for each item. Undoing a purchase does not bring back a quantity the purchase replaced: the result gives it as replacedQuantity, and set_pantry_status with that amount puts it back. A purchase also clears a running-low mark and says so as replacedLow; to undo such a purchase, name the item in restoreLowIds so it stays in the pantry, running low again.`,
  annotations: WRITE_ANNOTATIONS,
  inputSchema: z.object({
    ingredientIds: ingredientIdsSchema
      .max(MAX_INGREDIENTS)
      .describe('The ingredientId of each shopping list item, from get_shopping_list.'),
    purchased: z.boolean().describe('true when the items were bought, false to undo that.'),
    restoreLowIds: ingredientIdsSchema
      .max(MAX_INGREDIENTS)
      .optional()
      .describe(
        'Only when undoing: the ingredientIds whose purchase returned replacedLow. Each stays in the pantry, running low again, instead of being taken out.',
      ),
  }),
  outputSchema: z.object({
    purchased: z.boolean(),
    items: z.array(
      z.object({
        ingredientId: z.string(),
        outcome: z
          .enum([
            'in_pantry',
            'removed',
            'not_in_pantry',
            'ran_out',
            'too_old',
            'has_quantity',
            'restored',
          ])
          .describe(
            `in_pantry: bought and in the pantry. removed: taken back out of the pantry. not_in_pantry: it was not in the pantry. ran_out: a staple stays in the pantry as ran out, so it is on the shopping list again. too_old: it was bought more than ${UNPURCHASE_WINDOW_DAYS} days ago, so it stays. has_quantity: the pantry has a quantity for it that the household entered, so it stays; the household can change it in the app. restored: named in restoreLowIds, it stays in the pantry, running low again.`,
          ),
        replacedQuantity: z
          .number()
          .optional()
          .describe(
            'Only when bought: the quantity the pantry had for it before, which the purchase replaced with "have some". In the unit get_pantry reports.',
          ),
        replacedLow: z
          .literal(true)
          .optional()
          .describe(
            'Only when bought: the pantry had it marked running low, and the purchase cleared that. Name it in restoreLowIds to undo it.',
          ),
      }),
    ),
  }),
  run: async (household, { ingredientIds, purchased, restoreLowIds }) => {
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
        items: outcome.results.map(({ ingredientId, replacedQuantity, replacedLow }) => ({
          ingredientId,
          outcome: 'in_pantry' as const,
          ...(replacedQuantity !== null && { replacedQuantity }),
          ...(replacedLow && { replacedLow: true as const }),
        })),
      }
    }

    // One at a time, as the app undoes them: each is its own small change.
    // A row with a quantity is kept, so an undo never deletes a quantity the
    // household entered. A purchase replaces one with "have some", so it
    // returns `replacedQuantity` above, and `set_pantry_status` can write it
    // back as `amount` (HON-1402), so nothing is lost that cannot be restored:
    // `destructiveHint: false` stays true (HON-1176). `restoreLowIds` names
    // the rows the purchase took off running low, so each is low again and the
    // others are undone as before (HON-1586).
    const restoreLow = new Set(restoreLowIds)
    const items = []
    for (const ingredientId of uniqueIds) {
      const outcome = await unpurchaseIngredient(household.id, ingredientId, {
        keepWithQuantity: true,
        restoreLow: restoreLow.has(ingredientId),
      })
      items.push({ ingredientId, outcome })
    }
    return { purchased, items }
  },
})
