import { apiError, INTERNAL_ERROR_MESSAGE, serveApiRead } from '@/lib/api/v1/caller'
import { readShoppingList, shoppingListInputSchema } from '@/lib/api/v1/shopping-list'
import { captureApiError } from '@/lib/errors'
import { ToolInputError } from '@/lib/mcp/context'

const ROUTE = '/api/v1/shopping-list'

/**
 * GET /api/v1/shopping-list?days=7|14
 *
 * What the household needs to buy, for a screen or script, with a read-only
 * API key in `Authorization: Bearer wp_…` (HON-1220). The body is the
 * `get_shopping_list` MCP tool's; `days` defaults to 7. See docs/API.md.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    return await serveApiRead(request, ROUTE, (household) => {
      const days = new URL(request.url).searchParams.get('days')
      const input = shoppingListInputSchema.safeParse({
        days: days === null ? undefined : Number(days),
      })
      if (!input.success) throw new ToolInputError('Ask for days=7 or days=14.')
      return readShoppingList(household, input.data)
    })
  } catch (error) {
    // `serveApiRead` reports its own failures; this catches anything outside it.
    captureApiError(error, { route: ROUTE })
    return apiError(500, 'internal_error', INTERNAL_ERROR_MESSAGE)
  }
}
