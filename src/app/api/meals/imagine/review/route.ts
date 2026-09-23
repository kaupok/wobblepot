import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { reviewMealQuantities, type ReviewIngredient } from '@/lib/ai/review-quantities'
import {
  AiCostCapExceededError,
  assertUnderCap,
  recordAiUsage,
  respondCapExceeded,
} from '@/lib/ai/usage'
import { captureApiError } from '@/lib/errors'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'
import { isAiBudgetTimeout } from '@/lib/ai/timeout'
import { withRequestId } from '@/lib/request-id'

/**
 * Upper bound on the ingredient list one review may carry into the prompt.
 * An imagined meal is a home-cooked dish of a handful of ingredients; 40 leaves
 * room for the longest of those while refusing an arbitrarily long payload.
 */
const MAX_REVIEW_INGREDIENTS = 40

const reviewRequestSchema = z.object({
  mealName: z.string().min(1),
  servings: z.number().int().min(1).max(50),
  ingredients: z
    .array(
      z.object({
        ingredientId: z.string().min(1),
        name: z.string().min(1),
        quantityPerServing: z.number().positive(),
        unit: z.enum(['g', 'piece']),
      }),
    )
    .min(1)
    .max(MAX_REVIEW_INGREDIENTS),
})

/**
 * Wall-clock budget for the AI call in this request, in milliseconds.
 *
 * Shared by the initial attempt and every `maxRetries` retry rather than being
 * a per-attempt timeout, which makes it the real bound on retries — a fast
 * failure (429, 5xx) costs well under a second and still retries freely; a
 * slow generation does not.
 *
 * Sized against the figures recorded on Sonnet 5 during HON-693: preparation
 * tips 15-21s, quantity review 25-32s, both on deliberately hard inputs. This
 * route *is* the quantity review, so 45s is ~1.4x its own measured upper bound
 * — no extrapolation from a neighbouring call site is involved.
 *
 * The remaining 15s under `maxDuration` covers the session read, the
 * membership lookup and `assertUnderCap` before the call and the usage write
 * after it, which is what keeps the 504 below reachable instead of the
 * platform killing the function first. That is the same headroom the reference
 * route (`preparation-tips`) reserves, and less than `imagine/route.ts`'s 20s:
 * this route runs no ingredient matching and no nutrition reads, so its
 * non-AI work is the lightest of the AI routes.
 */
const AI_BUDGET_MS = 45_000

async function handlePOST(request: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  const { household } = membership

  // A 429 here degrades silently, like the budget timeout below: both callers
  // go through `reviewImaginedMeal`, which keeps the unreviewed meal and reports
  // the drop to PostHog, and no UI copy is shown (HON-722, option 1 — recorded
  // on the issue). The bucket is sized so only abuse reaches it, so a legitimate
  // user never takes this path. `code` is what the client keys that report on.
  const rateLimitResult = await checkRateLimit(household.id, 'meal-quantity-review')
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        code: 'rate_limited',
        message: `Maximum ${rateLimitResult.limit} quantity review requests per hour`,
        resetAt: rateLimitResult.resetAt.toISOString(),
      },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSeconds(rateLimitResult)) },
      },
    )
  }

  try {
    await assertUnderCap(household.id)
  } catch (error) {
    if (error instanceof AiCostCapExceededError) {
      return respondCapExceeded(error)
    }
    throw error
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = reviewRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request data' }, { status: 400 })
  }

  const { mealName, servings, ingredients } = parsed.data

  try {
    const reviewed = await reviewMealQuantities(
      mealName,
      servings,
      ingredients as ReviewIngredient[],
      household.locale,
      (usage) =>
        recordAiUsage({ householdId: household.id, feature: 'meal_review_quantities', ...usage }),
      AbortSignal.timeout(AI_BUDGET_MS),
    )

    // Filter out non-positive quantities the AI may return (schema can't enforce .positive())
    // Missing ingredients will keep their original quantities client-side
    const safeIngredients = reviewed.ingredients.filter((ing) => ing.quantityPerServing > 0)

    return NextResponse.json({ success: true, ingredients: safeIngredients })
  } catch (error) {
    captureApiError(error, {
      route: '/api/meals/imagine/review',
      userId: session.user.id,
      feature: 'meal_review_quantities',
      householdId: household.id,
    })

    // Reported before it is classified, as the sibling routes do: a fired
    // budget means the number above is mis-sized, which is exactly what should
    // show up in error tracking.
    //
    // Both callers degrade rather than render this body (see
    // `reviewImaginedMeal` in `lib/imagine-utils.ts`), so the distinct status
    // is what makes a mis-sized budget separable from a genuine AI failure in
    // the logs. Localizing the prose is HON-700's scope, not this route's.
    if (isAiBudgetTimeout(error)) {
      return NextResponse.json(
        { error: 'Reviewing the quantities took too long. Please try again.' },
        { status: 504 },
      )
    }

    return NextResponse.json({ error: 'Failed to review quantities' }, { status: 500 })
  }
}

/**
 * Platform execution ceiling for this route, in seconds.
 *
 * The quantity review scales with ingredient count and measured 25-32s on
 * Sonnet 5 for a 24-ingredient meal (HON-693). Stated explicitly because
 * `AI_BUDGET_MS` is only meaningful if the platform lets the function run that
 * long — otherwise the request is killed first and the 504 above never runs.
 * 60 is the value every Vercel plan allows, so this cannot fail to deploy.
 *
 * Both client callers go through `reviewImaginedMeal`, which waits 65s — above
 * this ceiling, so neither pre-empts it. It used to be 45s, under the ceiling,
 * which threw away work the household had already been billed for (HON-699).
 */
export const maxDuration = 60

export const POST = withRequestId(handlePOST)
