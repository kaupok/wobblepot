import 'server-only'

import { z } from 'zod'

import { displayUnit } from '@/lib/i18n/format-shopping-quantity'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import { deletePantryItemByIngredient, findPantryIngredient } from '@/lib/pantry/pantry-items'

export const removeFromPantry = defineTool({
  name: 'remove_from_pantry',
  title: 'Remove from pantry',
  description:
    'Takes an ingredient out of the pantry, as Remove on the pantry page does. Use it for an item put in by mistake, such as a wrong match from add_to_pantry. Pass an ingredientId from get_pantry or add_to_pantry. A staple stops being a staple too. The result gives the item as it was, so it can be put back with add_to_pantry and set_staple. To record that the household used something up, use set_pantry_status with ran_out instead: that keeps the item, and on a staple it puts the item on the shopping list.',
  // The result carries all a put-back needs, so the remove is not destructive.
  annotations: WRITE_ANNOTATIONS,
  inputSchema: z.object({
    ingredientId: z
      .string()
      .min(1)
      .describe('The ingredientId of the item, from get_pantry or add_to_pantry.'),
  }),
  outputSchema: z.object({
    outcome: z
      .enum(['removed', 'not_in_pantry'])
      .describe('removed: the item is gone. not_in_pantry: it was not there, so nothing changed.'),
    item: z
      .object({
        ingredientId: z.string(),
        name: z.string(),
        quantity: z
          .number()
          .nullable()
          .describe('The amount it had, as get_pantry reported it: null, the amount or 0.'),
        unit: z.string(),
        isStaple: z.boolean(),
      })
      .nullable()
      .describe('For removed: the item as it was before the remove.'),
  }),
  run: async (household, { ingredientId }) => {
    const found = await findPantryIngredient(household, ingredientId)
    if (found.status === 'ingredient_not_found') {
      throw new ToolInputError(
        'Wobblepot has no ingredient with this id. Use an ingredientId from get_pantry. Nothing was changed.',
      )
    }
    const { ingredient, item } = found
    if (!item) return { outcome: 'not_in_pantry' as const, item: null }

    const deleted = await deletePantryItemByIngredient(household.id, ingredientId)
    // Another request removed it after the read above: the end state is the same.
    if (deleted.status === 'not_found') return { outcome: 'not_in_pantry' as const, item: null }
    return {
      outcome: 'removed' as const,
      item: {
        ingredientId,
        name: ingredient.name,
        quantity: item.quantity,
        unit: displayUnit(ingredient),
        isStaple: item.isStaple,
      },
    }
  },
})
