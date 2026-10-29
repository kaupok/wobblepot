import { NextResponse } from 'next/server'

import type { NewIngredientInput } from '@/lib/ingredients/new-ingredient'
import { ingredientInputSchema } from '@/lib/ingredients/schema'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'

/**
 * The checks `POST /api/ingredients` and `PATCH` / `DELETE
 * /api/ingredients/[id]` share (HON-1264). Error strings are English, for
 * logs; the form branches on the status and the field names.
 */

/** The validated body, or the 400 to send. */
export async function parseIngredientBody(
  request: Request,
): Promise<{ data: NewIngredientInput } | { response: NextResponse }> {
  let body
  try {
    body = await request.json()
  } catch {
    return { response: NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  }

  const parsed = ingredientInputSchema.safeParse(body)
  if (!parsed.success) {
    return {
      response: NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      ),
    }
  }
  return { data: parsed.data }
}

/**
 * The 429 to send once the household is past the `ingredient-create` bucket,
 * else null. Create, edit and delete share the one bucket.
 */
export async function ingredientRateLimited(householdId: string): Promise<NextResponse | null> {
  const result = await checkRateLimit(householdId, 'ingredient-create')
  if (result.allowed) return null
  return NextResponse.json(
    {
      error: 'Rate limit exceeded',
      message: `Maximum ${result.limit} ingredient changes per hour`,
      resetAt: result.resetAt.toISOString(),
    },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds(result)) } },
  )
}
