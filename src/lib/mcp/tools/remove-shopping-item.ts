import 'server-only'
import { z } from 'zod'
import { deleteCustomShoppingItem, findCustomShoppingItemName } from '@/lib/shopping/custom-items'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'

export const removeShoppingItem = defineTool({
  name: 'remove_shopping_item',
  title: 'Remove shopping item',
  description:
    'Removes an item the household added to the shopping list by hand, by an id from customItems in get_shopping_list. Only those items can be removed: the items from planned meals follow the plan, so to drop one, change the plan or mark it bought with mark_purchased. An item a free-text extra put on the list is removed too; the extra stays on its day.',
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false },
  inputSchema: z.object({
    id: z.string().min(1).describe('The id of an item in customItems, from get_shopping_list.'),
  }),
  outputSchema: z.object({
    outcome: z.literal('removed'),
    id: z.string(),
    name: z.string(),
  }),
  run: async (household, { id }) => {
    // Read the name first, so the assistant can say what it removed.
    const name = await findCustomShoppingItemName(household.id, id)
    if (name === null || !(await deleteCustomShoppingItem(household.id, id))) {
      throw new ToolInputError(
        'No item with this id. Use get_shopping_list to find it. Nothing was changed.',
      )
    }
    return { outcome: 'removed' as const, id, name }
  },
})
