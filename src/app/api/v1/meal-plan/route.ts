import { apiError, INTERNAL_ERROR_MESSAGE, serveApiRead } from '@/lib/api/v1/caller'
import { mealPlanInputSchema, readMealPlan } from '@/lib/api/v1/meal-plan'
import { captureApiError } from '@/lib/errors'
import { ToolInputError } from '@/lib/mcp/context'

const ROUTE = '/api/v1/meal-plan'

/**
 * GET /api/v1/meal-plan?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * The household's meal plan for a screen or script, with a read-only API key
 * in `Authorization: Bearer wp_…` (HON-1220). The body is the
 * `get_meal_plan` MCP tool's: same defaults, same 31-day cap. See docs/API.md.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    return await serveApiRead(request, ROUTE, (household) => {
      const params = new URL(request.url).searchParams
      const input = mealPlanInputSchema.safeParse({
        from: params.get('from') ?? undefined,
        to: params.get('to') ?? undefined,
      })
      if (!input.success) throw new ToolInputError('Give from and to as dates, YYYY-MM-DD.')
      return readMealPlan(household, input.data)
    })
  } catch (error) {
    // `serveApiRead` reports its own failures; this catches anything outside it.
    captureApiError(error, { route: ROUTE })
    return apiError(500, 'internal_error', INTERNAL_ERROR_MESSAGE)
  }
}
