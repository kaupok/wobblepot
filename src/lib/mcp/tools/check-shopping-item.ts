import 'server-only'
import { z } from 'zod'
import { updateCustomShoppingItem } from '@/lib/shopping/custom-items'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'

export const checkShoppingItem = defineTool({
  name: 'check_shopping_item',
  title: 'Check shopping item',
  description:
    'Checks off an item the household added to the shopping list by hand, or unchecks it. Pass an id from customItems in get_shopping_list; for the items from planned meals, use mark_purchased. Checking off an item that Wobblepot matched to an ingredient also puts that ingredient in the pantry as "have some", replacing any quantity the pantry had for it. Unchecking does not bring that quantity back: the result gives it as replacedQuantity.',
  annotations: WRITE_ANNOTATIONS,
  inputSchema: z.object({
    id: z.string().min(1).describe('The id of an item in customItems, from get_shopping_list.'),
    checked: z.boolean().describe('true to check the item off, false to put it back on the list.'),
  }),
  outputSchema: z.object({
    item: z.object({ id: z.string(), name: z.string(), checked: z.boolean() }),
    replacedQuantity: z
      .number()
      .optional()
      .describe(
        'Only when checking off replaced one: the quantity the pantry had for the matched ingredient, in the unit get_pantry reports.',
      ),
  }),
  run: async (household, { id, checked }) => {
    const outcome = await updateCustomShoppingItem(household.id, id, { checked })
    if (outcome.status !== 'updated') {
      // Only `not_found` is possible: this tool sends no ingredient link.
      throw new ToolInputError(
        'No item with this id is on the shopping list. Use an id from customItems in get_shopping_list.',
      )
    }
    const { name, checked: isChecked } = outcome.item
    // `destructiveHint: false` holds because a replaced quantity is returned,
    // so the assistant can set it back, as with `mark_purchased` (HON-1176).
    return {
      item: { id, name, checked: isChecked },
      ...(outcome.replacedQuantity !== null && { replacedQuantity: outcome.replacedQuantity }),
    }
  },
})
