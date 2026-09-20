import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { imagineMeals } from '@/lib/ai/imagine-meal'
import { matchIngredients } from '@/lib/ai/match-ingredients'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'
import {
  AiCostCapExceededError,
  assertUnderCap,
  recordAiUsage,
  respondCapExceeded,
} from '@/lib/ai/usage'
import { captureApiError } from '@/lib/errors'
import { isAiBudgetTimeout } from '@/lib/ai/timeout'
import { deriveProteinType } from '@/lib/meal-planning/protein'
import { withRequestId } from '@/lib/request-id'
import type { ExtractedIngredient } from '@/lib/ai/recipe-schema'
import { MAX_ATTACHED_IMAGES, validateImageAttachments } from '@/lib/image-attachments'
import type { ImagineErrorCode } from '@/lib/ai/error-codes'

const imagineRequestSchema = z.object({
  prompt: z.string().min(1).max(500),
})

/**
 * Wall-clock budget for all AI time in this request, in milliseconds.
 *
 * Shared by the initial attempt and every `maxRetries` retry rather than being
 * a per-attempt timeout, which makes it the real bound on retries — a fast
 * failure (429, 5xx) costs well under a second and still retries freely; a
 * slow generation does not.
 *
 * Sized against the figures recorded on Sonnet 5 during HON-693: preparation
 * tips 15-21s, quantity review 25-32s, both on deliberately hard inputs.
 * Imagine is the quantity-review shape, but it also accepts photos, which add
 * input tokens and latency — so it is sized above that anchor rather than at
 * it. The remaining 20s under `maxDuration` covers base64-decoding up to
 * `MAX_ATTACHED_IMAGES` before the call and the three parallel
 * `matchIngredients` passes plus nutrition reads after it, which is what keeps
 * the 504 below reachable instead of the platform killing the function first.
 */
const AI_BUDGET_MS = 40_000

/**
 * Failure body for this route: English prose for logs and Sentry breadcrumbs,
 * plus the machine-readable `code` the clients translate (HON-700). Every
 * error response *this handler builds* goes through here, so no branch of it
 * can ship without a code. The one failure it does not build is the shared AI
 * cost-cap 429, which `respondCapExceeded` (`src/lib/ai/usage.ts`) returns
 * whole — it carries its own `ai_cap_exceeded` code.
 *
 * `success: false` mirrors `/api/recipes/parse` and the `success: true` this
 * route already sends on the happy path. Both clients test
 * `!response.ok || !data.success`, so they read it — and the shape the two AI
 * routes hand those clients should not differ by route.
 */
function errorBody(error: string, code: ImagineErrorCode) {
  return { success: false as const, error, code }
}

async function handlePOST(request: Request) {
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

  const { household } = membership

  const rateLimitResult = await checkRateLimit(household.id, 'meal-imagination')
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        ...errorBody('Rate limit exceeded', 'rate_limited'),
        message: `Maximum ${rateLimitResult.limit} meal imagination requests per hour`,
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

  // Parse request body — supports JSON (text-only) and FormData (with images)
  let prompt: string | null = null
  const images: { base64: string; mimeType: string }[] = []

  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const promptField = formData.get('prompt')
    if (promptField && typeof promptField === 'string' && promptField.trim()) {
      if (promptField.length > 500) {
        return NextResponse.json(
          errorBody('Prompt must be 500 characters or less', 'prompt_too_long'),
          { status: 400 },
        )
      }
      prompt = promptField.trim()
    }

    const imageFields = formData.getAll('image')
    const imageFiles = imageFields.filter((file) => file instanceof File)

    // Non-File entries can't be encoded, so they're skipped — but they still
    // occupy a slot against the cap, which is how this endpoint has always
    // counted them. Passing the difference as `alreadyAttached` keeps that.
    const rejection = validateImageAttachments(imageFiles, imageFields.length - imageFiles.length)
    if (rejection) {
      const [error, code]: [string, ImagineErrorCode] =
        rejection === 'too-many'
          ? [`Maximum ${MAX_ATTACHED_IMAGES} images allowed`, 'too_many_images']
          : rejection === 'wrong-type'
            ? ['Images must be JPEG, PNG, or WebP', 'wrong_image_type']
            : ['Each image must be 5MB or less', 'image_too_large']
      return NextResponse.json(errorBody(error, code), { status: 400 })
    }

    for (const file of imageFiles) {
      const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')
      images.push({ base64, mimeType: file.type })
    }

    if (!prompt && images.length === 0) {
      return NextResponse.json(
        errorBody(
          'Please provide a description or attach at least one image',
          'prompt_or_photo_required',
        ),
        { status: 400 },
      )
    }
  } else {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(errorBody('Invalid JSON', 'invalid_request'), { status: 400 })
    }

    const parsed = imagineRequestSchema.safeParse(body)
    if (!parsed.success) {
      // `min(1)` and `max(500)` are different user errors with different copy,
      // and this is the branch both clients take whenever no photo is attached
      // — collapsing them would answer a 501-character prompt with "describe
      // what kind of meal you want", and leave `prompt_too_long` reachable
      // only by attaching a photo.
      const tooLong = parsed.error.issues.some(
        (issue) => issue.code === 'too_big' && issue.path[0] === 'prompt',
      )
      return NextResponse.json(
        tooLong
          ? errorBody('Prompt must be 500 characters or less', 'prompt_too_long')
          : errorBody('Please enter a description of the meal you want', 'prompt_required'),
        { status: 400 },
      )
    }
    prompt = parsed.data.prompt
  }

  const preferences = household.preferences
  const householdSize = household._count.members

  try {
    // Generate meals with AI
    const generatedMeals = await imagineMeals(
      prompt,
      {
        allergens: (preferences?.allergensToAvoid ?? []) as string[],
        dietaryType: preferences?.dietaryType ?? null,
        excludedIngredients: (preferences?.excludedIngredients ?? []) as string[],
        restrictions: (preferences?.restrictions ?? []) as string[],
        householdSize,
      },
      household.locale,
      images.length > 0 ? images : undefined,
      (usage) => recordAiUsage({ householdId: household.id, feature: 'meal_imagine', ...usage }),
      AbortSignal.timeout(AI_BUDGET_MS),
    )

    // Match ingredients and compute nutrition for each meal
    const meals = await Promise.all(
      generatedMeals.map(async (meal, index) => {
        const extractedIngredients: ExtractedIngredient[] = meal.ingredients.map((ing) => ({
          name: ing.name,
          quantity: ing.quantity,
          unit: ing.unit,
          originalText: ing.originalText,
          isVague: ing.isVague,
          vaguePhrase: ing.vaguePhrase,
          isDried: ing.isDried,
        }))

        const matchResults = await matchIngredients(extractedIngredients, meal.servings, {
          householdId: household.id,
          locale: household.locale,
        })

        // Collect matched ingredient IDs to fetch nutrition data
        const matchedIds = matchResults
          .filter((r) => r.type === 'matched')
          .map((r) => (r as Extract<typeof r, { type: 'matched' }>).ingredient.id)

        // Fetch nutrition data for matched ingredients
        const ingredientNutrition =
          matchedIds.length > 0
            ? await prisma.ingredient.findMany({
                where: { id: { in: matchedIds } },
                select: {
                  id: true,
                  calories: true,
                  protein: true,
                  carbs: true,
                  fat: true,
                  proteinType: true,
                },
              })
            : []

        const nutritionMap = new Map(ingredientNutrition.map((ing) => [ing.id, ing]))

        // Build components and compute nutrition
        const nutrition = { calories: 0, protein: 0, carbs: 0, fat: 0 }
        const components = matchResults
          .filter((r) => r.type === 'matched')
          .map((r) => {
            const matched = r as Extract<typeof r, { type: 'matched' }>
            const quantityPerServing = matched.convertedQuantity / meal.servings
            const ingNutrition = nutritionMap.get(matched.ingredient.id)

            if (ingNutrition) {
              const factor = quantityPerServing / 100
              nutrition.calories += ingNutrition.calories * factor
              nutrition.protein += ingNutrition.protein * factor
              nutrition.carbs += ingNutrition.carbs * factor
              nutrition.fat += ingNutrition.fat * factor
            }

            return {
              ingredientId: matched.ingredient.id,
              quantityPerServing,
              ingredient: {
                id: matched.ingredient.id,
                name: matched.ingredient.name,
                category: matched.ingredient.category,
                defaultUnit: matched.ingredient.defaultUnit,
                gramsPerPiece: matched.ingredient.gramsPerPiece,
                calories: matched.ingredient.calories,
                protein: matched.ingredient.protein,
                carbs: matched.ingredient.carbs,
                fat: matched.ingredient.fat,
              },
            }
          })

        // Derive protein type from matched components
        const componentDataForProtein = components.map((comp) => ({
          quantityPerServing: comp.quantityPerServing,
          ingredient: {
            proteinType: nutritionMap.get(comp.ingredientId)?.proteinType ?? null,
            protein: nutritionMap.get(comp.ingredientId)?.protein ?? 0,
          },
        }))
        const primaryProteinType = deriveProteinType(componentDataForProtein)

        return {
          id: `imagined-${index}`,
          name: meal.name,
          description: meal.description,
          timeMinutes: meal.timeMinutes,
          servings: meal.servings,
          suitableFor: meal.mealTypes,
          kidFriendly: meal.kidFriendly,
          primaryProteinType,
          components,
          nutrition: {
            calories: Math.round(nutrition.calories),
            protein: Math.round(nutrition.protein),
            carbs: Math.round(nutrition.carbs),
            fat: Math.round(nutrition.fat),
          },
          ingredients: matchResults,
          allMatched: matchResults.every((r) => r.type === 'matched'),
        }
      }),
    )

    return NextResponse.json({ success: true, meals })
  } catch (error) {
    captureApiError(error, {
      route: '/api/meals/imagine',
      userId: session.user.id,
      feature: 'meal_imagine',
      householdId: household.id,
    })

    // Reported before it is classified, as the reference route does: a timeout
    // is user-facing but it also means the budget above is mis-sized, which is
    // exactly what should show up in Sentry.
    if (isAiBudgetTimeout(error)) {
      return NextResponse.json(
        errorBody('Generating meal ideas took too long. Please try again.', 'imagine_timeout'),
        { status: 504 },
      )
    }

    return NextResponse.json(
      errorBody('Failed to generate meal ideas. Please try again.', 'imagine_failed'),
      { status: 500 },
    )
  }
}

export const POST = withRequestId(handlePOST)

/**
 * Platform execution ceiling for this route, in seconds.
 *
 * Stated explicitly because `AI_BUDGET_MS` is only meaningful if the platform
 * lets the function run that long — otherwise the request is killed first and
 * the friendly 504 above never runs. 60 is the value every Vercel plan allows,
 * so this cannot fail to deploy (HON-693).
 *
 * Both client callers (`ImagineClient`, `ImaginePanel`) abort only on an
 * explicit user cancel or unmount, so neither pre-empts this ceiling.
 */
export const maxDuration = 60
