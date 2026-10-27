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
import { withRequestId } from '@/lib/request-id'
import { MAX_SERVINGS, MIN_SERVINGS, sumPortions } from '@/lib/meal-planning/servings'
import { translateIngredient, translateMeal } from '@/lib/i18n/content'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { loadPantryNamesForAi } from '@/lib/meal-plans/entry-context'
import {
  freshRecipeSteps,
  loadRecipeForSteps,
  RecipeStepsError,
  recipeStepsRequest,
} from '@/lib/meals/recipe-steps'

/**
 * The entry route's body (`cookQuestionFields`), plus the servings the view
 * shows, in halves (HON-1040): the steps and the amounts on screen are priced
 * at them. The range is checked once the household is known, below.
 */
const bodySchema = z
  .object({ ...cookQuestionFields, servings: z.number().positive().multipleOf(0.5) })
  .refine(subjectInRange)

/**
 * Ask in the recipe cook view (HON-1339): a question about a step or a
 * "You'll need" item of one of the household's own recipes or a library meal
 * the meal picker shows (HON-1351), with no plan entry. The same prompt,
 * guards and streamed answer as a planned entry's
 * (`@/lib/ai/cook-question-route`), with the recipe as it is stored: no
 * ingredient changes, no "Adjust recipe" note, no serving override.
 */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const { subject, steps, equipment, question, previous, servings } = parsed.data

  const { household } = membership
  // The serving control's range, or the household's own count, which a large
  // household can take past it, as the steps route allows.
  const householdServings = sumPortions(household.members)
  if (servings !== householdServings && (servings < MIN_SERVINGS || servings > MAX_SERVINGS)) {
    return NextResponse.json(errorBody('Invalid question', 'invalid_question'), { status: 400 })
  }

  const { id: mealId } = await params
  // Resolved, so a locale rolled back out of KNOWN_LOCALES gets English names
  // and an English prompt (HON-921). This route writes nothing.
  const locale = resolveHouseholdLocale(household)
  const errorContext = {
    route: '/api/meals/[id]/cook-question',
    userId: session.user.id,
    feature: 'cook_question',
  }

  try {
    // The household's own recipe or a library meal. Another household's
    // recipe and a deleted meal throw.
    const meal = await loadRecipeForSteps(household.id, mealId, locale)

    const refused = await guardCookQuestion(household.id, session.user.id)
    if (refused) return refused

    // Names only: the answer may say what the household has, never how much.
    const pantryItems = await loadPantryNamesForAi(household.id, locale)

    // The stored steps give Watch out and Tip when they were written at these
    // servings from this recipe. The steps never come from here: the request
    // carries the ones on screen.
    const { inputHash } = recipeStepsRequest(meal, locale, servings)
    const cachedTips = freshRecipeSteps(meal, inputHash)
    const shownMeal = translateMeal(meal, locale)
    const mealName = shownMeal.name
    const preferences = household.preferences

    const aiRequest = buildCookQuestionRequest({
      mealName,
      servings,
      timeMinutes: meal.timeMinutes,
      components: meal.components.map((comp) => ({
        name: translateIngredient(comp.ingredient, locale).name,
        quantityPerServing: comp.quantityPerServing,
        defaultUnit: comp.ingredient.defaultUnit,
        measuredByVolume: comp.ingredient.measuredByVolume,
      })),
      // A household's own recipe lists the whole meal (HON-1245). A library
      // meal is the library's recipe, unchanged, with no household notes, as
      // its steps were written (`recipeStepsRequest`).
      hasChanges: !!meal.householdId,
      preparationNotes: meal.householdId ? (shownMeal.preparationNotes ?? null) : null,
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

    return await streamCookAnswer({
      aiRequest,
      householdId: household.id,
      locale,
      sampleInput: {
        mealName,
        subject,
        source: cachedTips ? 'cached' : 'uncached',
        mode: 'recipe',
      },
      errorContext,
    })
  } catch (error) {
    if (error instanceof RecipeStepsError) {
      return NextResponse.json(errorBody('Meal not found', 'meal_not_found'), { status: 404 })
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
