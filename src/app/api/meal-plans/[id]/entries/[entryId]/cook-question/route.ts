import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { buildCookQuestionRequest } from '@/lib/ai/cook-question'
import {
  cookQuestionErrorBody as errorBody,
  cookQuestionErrorResponse,
  cookQuestionFields,
  guardCookQuestion,
  streamCookAnswer,
  subjectInRange,
} from '@/lib/ai/cook-question-route'
import { parseCachedPreparationSteps } from '@/lib/preparation-steps'
import { withRequestId } from '@/lib/request-id'
import { getCookServings, sumPortions } from '@/lib/meal-planning/servings'
import { hasLiveChanges } from '@/lib/meal-planning/entry-components'
import { translateIngredient, translateMeal } from '@/lib/i18n/content'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import {
  EntryContextError,
  loadEntryForAi,
  loadPantryNamesForAi,
} from '@/lib/meal-plans/entry-context'

/** The body, its bounds and the subject check: `cookQuestionFields`. */
const bodySchema = z.object(cookQuestionFields).refine(subjectInRange)

async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json(errorBody('Unauthorized', 'unauthorized'), { status: 401 })
  }

  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json(errorBody('No household found', 'no_household'), { status: 404 })
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(errorBody('Invalid question', 'invalid_question'), { status: 400 })
  }
  const { subject, steps, equipment, question, previous } = parsed.data

  const { household } = membership
  const { id: planId, entryId } = await params
  // Resolved, so a locale rolled back out of KNOWN_LOCALES gets English names
  // and an English prompt (HON-921). This route writes nothing, so there is
  // no cache to guard against the stored locale.
  const locale = resolveHouseholdLocale(household)
  const errorContext = {
    route: '/api/meal-plans/[id]/entries/[entryId]/cook-question',
    userId: session.user.id,
    feature: 'cook_question',
  }

  try {
    const entry = await loadEntryForAi(household.id, planId, entryId, locale)

    if (!entry.meal) {
      return NextResponse.json(errorBody('No meal assigned to this entry', 'no_meal'), {
        status: 400,
      })
    }

    const refused = await guardCookQuestion(household.id, session.user.id)
    if (refused) return refused

    // Names only: the answer may say what the household has, never how much.
    const pantryItems = await loadPantryNamesForAi(household.id, locale)

    // The household's names, as the tips prompt reads them (HON-913).
    const shownMeal = translateMeal(entry.meal, locale)
    const mealName = shownMeal.name
    // The cached tips give Watch out and Tip when the entry holds them. The
    // steps never come from here: the request carries the ones on screen.
    const servings = getCookServings(entry, sumPortions(household.members))
    // Only tips priced at these servings, as the tips route serves them.
    const cachedTips = entry.preparationTips
      ? parseCachedPreparationSteps(entry.preparationTips, {
          servings,
          legacyServings: entry.servingOverride ?? household._count.members,
        })
      : null
    const preferences = household.preferences

    const aiRequest = buildCookQuestionRequest({
      mealName,
      servings,
      timeMinutes: entry.meal.timeMinutes,
      // The entry's own changes merged over the recipe (HON-1243).
      components: entry.components.map((comp) => ({
        name: translateIngredient(comp.ingredient, locale).name,
        quantityPerServing: comp.quantityPerServing,
        defaultUnit: comp.ingredient.defaultUnit,
        measuredByVolume: comp.ingredient.measuredByVolume,
      })),
      // The list is then the whole meal, not the name's (HON-1254), and
      // always on the household's own recipe (HON-1245).
      hasChanges: hasLiveChanges(entry.meal.components, entry.changes) || !!entry.meal.householdId,
      preparationNotes: shownMeal.preparationNotes ?? null,
      steps,
      equipment,
      subject,
      pitfalls: cachedTips?.pitfalls ?? [],
      tip: cachedTips?.tip ?? null,
      pantry: pantryItems.map((item) => ({
        name: translateIngredient(item.ingredient, locale).name,
        isStaple: item.isStaple,
      })),
      // Passed as restrictions the model must follow, not preferences (HON-896).
      restrictions: {
        allergens: (preferences?.allergensToAvoid ?? []) as string[],
        dietaryType: preferences?.dietaryType ?? null,
        excludedIngredients: preferences?.excludedIngredients ?? [],
        restrictions: preferences?.restrictions ?? [],
      },
      question,
      previous,
      locale,
    })

    // `source` is where Watch out and Tip came from: the entry's cached tips,
    // or none because the steps were served uncached. The chip-or-typed
    // source is the analytics event's, and the route never sees it.
    return await streamCookAnswer({
      aiRequest,
      householdId: household.id,
      locale,
      sampleInput: { mealName, subject, source: cachedTips ? 'cached' : 'uncached' },
      errorContext,
    })
  } catch (error) {
    if (error instanceof EntryContextError) {
      return NextResponse.json(errorBody('Entry not found', 'entry_not_found'), { status: 404 })
    }

    return cookQuestionErrorResponse(error, errorContext)
  }
}

/**
 * Platform execution ceiling for this route, in seconds. Stated so the
 * `COOK_QUESTION_AI_BUDGET_MS` budget and its 504 stay reachable (HON-693).
 */
export const maxDuration = 60

export const POST = withRequestId(handlePOST)
