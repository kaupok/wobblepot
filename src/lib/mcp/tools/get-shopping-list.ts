import 'server-only'

import {
  readShoppingList,
  shoppingListInputSchema,
  shoppingListOutputSchema,
} from '@/lib/api/v1/shopping-list'
import { defineTool } from '@/lib/mcp/context'

/** The read is shared with `GET /api/v1/shopping-list` (HON-1220). */
export const getShoppingList = defineTool({
  name: 'get_shopping_list',
  title: 'Get shopping list',
  description:
    'Returns what the household needs to buy for its planned meals in the next 7 or 14 days, plus the staples it marked ran out and the items it added by hand. Use it to answer whether to buy something, or what to get at the shop. An item marked purchased is already in the pantry.',
  inputSchema: shoppingListInputSchema,
  outputSchema: shoppingListOutputSchema,
  run: readShoppingList,
})
