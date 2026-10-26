import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { deleteHouseholdIngredient, updateHouseholdIngredient } from '@/lib/ingredients/manage'
import { ingredientRateLimited, parseIngredientBody } from '../request'

const ROUTE = '/api/ingredients/[id]'

type Params = { params: Promise<{ id: string }> }

/** A global row or another household's row answers this, so its id is not confirmed. */
const notFound = () => NextResponse.json({ error: 'Ingredient not found' }, { status: 404 })

/** The session and the household, or the 401 / 403 to send. */
async function requireHousehold() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const membership = await getHouseholdMembership(session.user.id)
  if (!membership) {
    return { response: NextResponse.json({ error: 'No household found' }, { status: 403 }) }
  }
  return { userId: session.user.id, household: membership.household }
}

/**
 * PATCH /api/ingredients/[id]
 *
 * Edits an ingredient the household added (HON-1264), with the body `POST
 * /api/ingredients` takes. 409 `name_taken` for a name the catalogue already
 * has, 409 `unit_locked` for a unit change on a row in use.
 */
export async function PATCH(request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params
  const caller = await requireHousehold()
  if (caller.response) return caller.response

  const parsed = await parseIngredientBody(request)
  if ('response' in parsed) return parsed.response

  const { household } = caller
  try {
    const limited = await ingredientRateLimited(household.id)
    if (limited) return limited

    const result = await updateHouseholdIngredient(
      household.id,
      resolveHouseholdLocale(household),
      id,
      parsed.data,
    )
    switch (result.status) {
      case 'updated':
        return NextResponse.json({ ingredient: result.ingredient })
      case 'not_found':
        return notFound()
      case 'name_taken':
        return NextResponse.json(
          { error: 'An ingredient with this name exists', code: 'name_taken' },
          { status: 409 },
        )
      default:
        return NextResponse.json(
          {
            error: 'The unit of a used ingredient cannot change',
            code: 'unit_locked',
            uses: result.uses,
          },
          { status: 409 },
        )
    }
  } catch (error) {
    captureApiError(error, { route: ROUTE, userId: caller.userId })
    return NextResponse.json({ error: 'Failed to update ingredient' }, { status: 500 })
  }
}

/**
 * DELETE /api/ingredients/[id]
 *
 * Deletes an ingredient the household added (HON-1264). 409 `in_use`, with the
 * counts in `uses`, while anything still holds it.
 */
export async function DELETE(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params
  const caller = await requireHousehold()
  if (caller.response) return caller.response

  try {
    const limited = await ingredientRateLimited(caller.household.id)
    if (limited) return limited

    const result = await deleteHouseholdIngredient(caller.household.id, id)
    if (result.status === 'not_found') return notFound()
    if (result.status === 'in_use') {
      return NextResponse.json(
        { error: 'Ingredient in use', code: 'in_use', uses: result.uses },
        { status: 409 },
      )
    }
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    captureApiError(error, { route: ROUTE, userId: caller.userId })
    return NextResponse.json({ error: 'Failed to delete ingredient' }, { status: 500 })
  }
}
