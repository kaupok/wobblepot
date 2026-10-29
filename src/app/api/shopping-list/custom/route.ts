import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { markStapleRanOutByName } from '@/lib/pantry/staple-ran-out'
import { addCustomShoppingItem, customItemNameSchema } from '@/lib/shopping/custom-items'

const createSchema = z.object({
  name: customItemNameSchema,
})

/**
 * POST /api/shopping-list/custom
 *
 * Create a custom shopping list item. Auto-matches against the ingredient DB
 * using fuzzy search. Returns the created item with match info.
 * The `add_shopping_item` MCP tool calls the same `addCustomShoppingItem`.
 *
 * A name that is exactly one of the household's staples marks that staple
 * ran out in place of a custom item, and returns 200 with
 * `{ status: 'staple_ran_out', pantryItemId, ingredientName }` (HON-1400).
 * Only this route does it: the MCP tool and the day extras keep making items.
 */
export async function POST(request: Request) {
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

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = createSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const { name } = parsed.data

  try {
    const staple = await markStapleRanOutByName(household, name)
    if (staple.status === 'staple_ran_out') {
      return NextResponse.json(staple, { status: 200 })
    }

    const outcome = await addCustomShoppingItem(household, name)
    switch (outcome.status) {
      case 'created':
        return NextResponse.json({ item: outcome.item }, { status: 201 })
      case 'reopened':
        return NextResponse.json({ item: outcome.item }, { status: 200 })
      case 'exists':
        return NextResponse.json(
          outcome.existing
            ? { error: 'Item already exists', existing: outcome.existing }
            : { error: 'Item already exists' },
          { status: 409 },
        )
    }
  } catch (error) {
    captureApiError(error, { route: '/api/shopping-list/custom', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to create item' }, { status: 500 })
  }
}
