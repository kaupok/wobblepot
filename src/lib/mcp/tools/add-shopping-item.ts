import 'server-only'

import { z } from 'zod'

import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import { addCustomShoppingItem, customItemNameSchema } from '@/lib/shopping/custom-items'

export const addShoppingItem = defineTool({
  name: 'add_shopping_item',
  title: 'Add shopping item',
  description:
    'Adds an item to the shopping list by name, such as "dish soap" or "milk". It shows among the items the household added by hand (customItems in get_shopping_list). An item with the same name is not added twice: if it was checked off, it goes back on the list. To put food the household already bought in the pantry, use add_to_pantry, not this tool.',
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false },
  inputSchema: z.object({
    name: customItemNameSchema.describe(
      'What to buy, as the household would write it on the list, in its own language.',
    ),
  }),
  outputSchema: z.object({
    outcome: z
      .enum(['added', 'back_on_list', 'already_on_list'])
      .describe(
        'added: a new item. back_on_list: it was checked off and is unchecked again. already_on_list: it was on the list already, so nothing changed.',
      ),
    item: z.object({ id: z.string(), name: z.string(), checked: z.boolean() }),
  }),
  run: async (household, { name }) => {
    const outcome = await addCustomShoppingItem(household, name)
    switch (outcome.status) {
      case 'created':
      case 'reopened': {
        const { id, name: itemName, checked } = outcome.item
        return {
          outcome: outcome.status === 'created' ? ('added' as const) : ('back_on_list' as const),
          item: { id, name: itemName, checked },
        }
      }
      case 'exists': {
        if (!outcome.existing) {
          throw new ToolInputError('This item is already on the shopping list.')
        }
        const { id, name: itemName, checked } = outcome.existing
        return { outcome: 'already_on_list' as const, item: { id, name: itemName, checked } }
      }
    }
  },
})
