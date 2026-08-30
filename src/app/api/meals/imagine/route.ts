import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership, getHouseholdMemberCount } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { imagineMeals } from '@/lib/ai/imagine-meal'
import { matchIngredients } from '@/lib/ai/parse-recipe'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'
import {
  AiCostCapExceededError,
  assertUnderCap,
  recordAiUsage,
  respondCapExceeded,
} from '@/lib/ai/usage'
import { captureApiError } from '@/lib/errors'
import { deriveProteinType } from '@/lib/meal-planning/protein'
import { withRequestId } from '@/lib/request-id'
import type { ExtractedIngredient } from '@/lib/ai/recipe-schema'
import { MAX_ATTACHED_IMAGES, validateImageAttachments } from '@/lib/image-attachments'

const imagineRequestSchema = z.object({
  prompt: z.string().min(1).max(500),
})

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

  const rateLimitResult = await checkRateLimit(household.id, 'meal-imagination')
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
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
          { error: 'Prompt must be 500 characters or less' },
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
      const error =
        rejection === 'too-many'
          ? `Maximum ${MAX_ATTACHED_IMAGES} images allowed`
          : rejection === 'wrong-type'
            ? 'Images must be JPEG, PNG, or WebP'
            : 'Each image must be 5MB or less'
      return NextResponse.json({ error }, { status: 400 })
    }

    for (const file of imageFiles) {
      const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')
      images.push({ base64, mimeType: file.type })
    }

    if (!prompt && images.length === 0) {
      return NextResponse.json(
        { error: 'Please provide a description or attach at least one image' },
        { status: 400 },
      )
    }
  } else {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = imagineRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Please enter a description of the meal you want' },
        { status: 400 },
      )
    }
    prompt = parsed.data.prompt
  }

  const preferences = household.preferences
  const householdSize = await getHouseholdMemberCount(household.id)

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
    return NextResponse.json(
      { error: 'Failed to generate meal ideas. Please try again.' },
      { status: 500 },
    )
  }
}

export const POST = withRequestId(handlePOST)
