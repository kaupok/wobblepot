import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import type { EntryChangeRefusal } from '@/lib/meal-plans/entry-changes'

/**
 * The answer to each refusal from the change writes and `promoteEntry`;
 * see `EntryChangeRefusal` for when each is raised. `code` is what the client
 * renders catalog copy from; `error` is English, for logs.
 */
export const REFUSALS: Record<EntryChangeRefusal, { status: number; error: string }> = {
  entryNotFound: { status: 404, error: 'Entry not found or access denied' },
  changeNotFound: { status: 404, error: 'Change not found' },
  ingredientNotFound: { status: 404, error: 'Ingredient not found' },
  notPlanned: { status: 409, error: 'Only a planned meal can be changed' },
  originalNotInMeal: { status: 400, error: 'The ingredient is not in this meal' },
  alreadyChanged: { status: 409, error: 'This ingredient is already changed' },
  alreadyInMeal: { status: 409, error: 'This ingredient is already in the meal' },
  changesMoved: { status: 409, error: "The meal's changes moved since the set was built" },
  noChanges: { status: 409, error: 'The entry has no change to keep' },
  mealNotFound: { status: 404, error: 'Meal not found' },
  invalidRecipe: { status: 400, error: 'A recipe cannot hold this ingredient list' },
}

export function refusalResponse(reason: EntryChangeRefusal) {
  const { status, error } = REFUSALS[reason]
  return NextResponse.json({ error, code: reason }, { status })
}

/** The signed-in user's household, or the response that refuses the request. */
export async function requireHousehold(): Promise<
  { ok: true; userId: string; householdId: string } | { ok: false; response: NextResponse }
> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const membership = await getHouseholdMembership(session.user.id)
  if (!membership) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'No household found' }, { status: 404 }),
    }
  }
  return { ok: true, userId: session.user.id, householdId: membership.household.id }
}
