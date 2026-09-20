import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership } from '@/lib/household'
import { deriveProteinType } from '@/lib/meal-planning/protein'
import {
  ingredientTranslationsInclude,
  mealTranslationsInclude,
  translateIngredient,
  translateMeal,
} from '@/lib/i18n/content'
import { captureApiError } from '@/lib/errors'

const updateMealSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  preparationNotes: z.string().max(5000).nullable().optional(),
  sourceUrl: z
    .string()
    .url()
    .max(2000)
    .refine((url) => /^https?:\/\//i.test(url), 'Only http/https URLs are allowed')
    .nullable()
    .optional(),
  timeMinutes: z.number().int().positive().max(480).nullable().optional(),
  kidFriendly: z.boolean().optional(),
  suitableFor: z
    .array(z.enum(['breakfast', 'lunch', 'dinner']))
    .min(1)
    .optional(),
  servings: z.number().int().positive().max(50).optional(),
  components: z
    .array(
      z
        .object({
          ingredientId: z.string().min(1),
          totalQuantity: z.number().nonnegative(),
          isVague: z.boolean().optional().default(false),
          originalPhrase: z.string().nullish(),
        })
        .refine((c) => c.isVague || c.totalQuantity > 0, {
          message: 'Quantity must be greater than 0 for non-vague components',
        })
        .transform((c) => ({
          ...c,
          totalQuantity: c.isVague ? 0 : c.totalQuantity,
        })),
    )
    .min(1)
    .optional(),
})

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const membership = await getHouseholdMembership(session.user.id)

    if (!membership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    const householdLocale = membership.household.locale
    const meal = await prisma.meal.findFirst({
      where: {
        id,
        householdId: membership.household.id,
      },
      select: {
        id: true,
        name: true,
        description: true,
        preparationNotes: true,
        sourceUrl: true,
        timeMinutes: true,
        kidFriendly: true,
        primaryProteinType: true,
        suitableFor: true,
        servings: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
        components: {
          select: {
            ingredientId: true,
            quantityPerServing: true,
            isVague: true,
            originalPhrase: true,
            ingredient: {
              select: {
                id: true,
                name: true,
                category: true,
                defaultUnit: true,
                gramsPerPiece: true,
                calories: true,
                protein: true,
                carbs: true,
                fat: true,
                allergens: true,
                ...ingredientTranslationsInclude(householdLocale),
              },
            },
          },
        },
        favoritedBy: {
          where: { householdId: membership.household.id },
          select: { id: true },
        },
        ...mealTranslationsInclude(householdLocale),
      },
    })

    if (!meal) {
      return NextResponse.json({ error: 'Meal not found' }, { status: 404 })
    }

    const nutrition = meal.components.reduce(
      (acc, comp) => {
        if (comp.isVague) return acc
        const factor = comp.quantityPerServing / 100
        return {
          calories: acc.calories + comp.ingredient.calories * factor,
          protein: acc.protein + comp.ingredient.protein * factor,
          carbs: acc.carbs + comp.ingredient.carbs * factor,
          fat: acc.fat + comp.ingredient.fat * factor,
        }
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    )

    const allergens = [...new Set(meal.components.flatMap((comp) => comp.ingredient.allergens))]
    const translatedMeal = translateMeal(meal, householdLocale)

    return NextResponse.json({
      id: translatedMeal.id,
      name: translatedMeal.name,
      description: translatedMeal.description,
      preparationNotes: translatedMeal.preparationNotes,
      sourceUrl: meal.sourceUrl,
      timeMinutes: translatedMeal.timeMinutes,
      kidFriendly: translatedMeal.kidFriendly,
      primaryProteinType: translatedMeal.primaryProteinType,
      suitableFor: translatedMeal.suitableFor,
      servings: meal.servings,
      isCustom: true,
      isFavorite: meal.favoritedBy.length > 0,
      deletedAt: meal.deletedAt,
      createdAt: meal.createdAt,
      updatedAt: meal.updatedAt,
      components: meal.components.map((comp) => {
        const translatedIngredient = translateIngredient(comp.ingredient, householdLocale)
        return {
          ingredientId: comp.ingredientId,
          quantityPerServing: comp.quantityPerServing,
          isVague: comp.isVague,
          originalPhrase: comp.originalPhrase,
          ingredient: {
            id: translatedIngredient.id,
            name: translatedIngredient.name,
            category: translatedIngredient.category,
            defaultUnit: translatedIngredient.defaultUnit,
            gramsPerPiece: translatedIngredient.gramsPerPiece,
            calories: comp.ingredient.calories,
            protein: comp.ingredient.protein,
            carbs: comp.ingredient.carbs,
            fat: comp.ingredient.fat,
          },
        }
      }),
      nutrition: {
        calories: Math.round(nutrition.calories),
        protein: Math.round(nutrition.protein),
        carbs: Math.round(nutrition.carbs),
        fat: Math.round(nutrition.fat),
      },
      allergens,
    })
  } catch (error) {
    captureApiError(error, { route: '/api/households/me/meals/[id]', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to fetch meal' }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = updateMealSchema.safeParse(body)

    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
    }

    const membership = await getHouseholdMembership(session.user.id)

    if (!membership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    // Verify meal exists and belongs to this household. The components come
    // along so the prep-tips invalidation below can tell a real ingredient
    // edit from the unchanged list every save resends.
    const existingMeal = await prisma.meal.findFirst({
      where: {
        id,
        householdId: membership.household.id,
        deletedAt: null,
      },
      include: {
        components: {
          select: { ingredientId: true, quantityPerServing: true },
        },
      },
    })

    if (!existingMeal) {
      return NextResponse.json({ error: 'Meal not found' }, { status: 404 })
    }

    const {
      name,
      description,
      preparationNotes,
      sourceUrl,
      timeMinutes,
      kidFriendly,
      suitableFor,
      servings,
      components,
    } = parsed.data

    // `components` and `servings` are independently optional in the schema, so
    // a components-only PATCH has to scale against something. The meal's own
    // stored `servings` is that divisor — it is what the rows already on disk
    // are kept under, and `Meal.servings` is non-nullable, so it always exists.
    // Gating the component path on both fields instead dropped the whole edit
    // and still answered 200 with the unchanged list (HON-701).
    const componentServings = servings ?? existingMeal.servings

    // If components are being updated, verify all ingredients exist and recalculate protein type
    let primaryProteinType = existingMeal.primaryProteinType
    let componentsChanged = false
    if (components) {
      const ingredientIds = components.map((c) => c.ingredientId)
      const ingredients = await prisma.ingredient.findMany({
        where: { id: { in: ingredientIds } },
        select: {
          id: true,
          proteinType: true,
          protein: true,
        },
      })

      if (ingredients.length !== ingredientIds.length) {
        const foundIds = new Set(ingredients.map((i) => i.id))
        const missingIds = ingredientIds.filter((id) => !foundIds.has(id))
        return NextResponse.json(
          { error: 'Some ingredients not found', missingIds },
          { status: 400 },
        )
      }

      // Derive primary protein type from ingredients
      const ingredientMap = new Map(ingredients.map((i) => [i.id, i]))
      const componentData = components.map((c) => ({
        quantityPerServing: c.totalQuantity / componentServings,
        ingredient: ingredientMap.get(c.ingredientId)!,
      }))
      primaryProteinType = deriveProteinType(componentData)

      // The prep-tips prompt renders one line per component from its
      // ingredient and its `quantityPerServing` — the same division applied
      // below — so those two fields are the whole of what a tips regeneration
      // would see. `isVague` and `originalPhrase` are not in the prompt, and a
      // vague flip zeroes `totalQuantity` in the schema transform, so it shows
      // up here as a quantity change anyway.
      const existingQuantities = new Map(
        existingMeal.components.map((c) => [c.ingredientId, c.quantityPerServing]),
      )
      componentsChanged =
        components.length !== existingMeal.components.length ||
        components.some(
          (c) => existingQuantities.get(c.ingredientId) !== c.totalQuantity / componentServings,
        )
    }

    // Build update data
    const updateData: {
      name?: string
      description?: string | null
      preparationNotes?: string | null
      sourceUrl?: string | null
      timeMinutes?: number | null
      kidFriendly?: boolean
      suitableFor?: ('breakfast' | 'lunch' | 'dinner')[]
      servings?: number
      primaryProteinType?: typeof primaryProteinType
    } = {}

    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (preparationNotes !== undefined) updateData.preparationNotes = preparationNotes
    if (sourceUrl !== undefined) updateData.sourceUrl = sourceUrl
    if (timeMinutes !== undefined) updateData.timeMinutes = timeMinutes
    if (kidFriendly !== undefined) updateData.kidFriendly = kidFriendly
    if (suitableFor !== undefined) updateData.suitableFor = suitableFor
    if (servings !== undefined) updateData.servings = servings
    if (components) updateData.primaryProteinType = primaryProteinType

    // Use transaction to update meal and components atomically
    const meal = await prisma.$transaction(async (tx) => {
      // Update meal base fields
      await tx.meal.update({
        where: { id },
        data: updateData,
      })

      // Every field below is an input to the cached prep-tips prompt
      // (`MealPlanEntry.preparationTips`): `buildFullTipsPrompt` takes
      // `mealName`, `timeMinutes` and an ingredient list built from the
      // meal's components, and `preparationNotes` both feeds
      // `buildSupplementaryTipsPrompt` and selects which of the two prompts
      // runs. Leaving tips cached after a component swap means "pat the
      // chicken dry" survives on a meal that is now tofu, and every read is a
      // cache hit, so nothing regenerates it. Invalidate here for the same
      // reason `PATCH /api/households/me` invalidates on a locale change
      // (HON-683, HON-681, and the AI-cache rule in `docs/LOCALIZATION.md`).
      //
      // Per-field on purpose: `sourceUrl`, `description`, `kidFriendly` and
      // `suitableFor` never reach the prompt, so an edit touching only those
      // must not burn a regeneration across the household's whole plan.
      //
      // `Meal.servings` has no clause of its own, for the same reason: the
      // prompt scales by the entry's effective servings
      // (`getEffectiveServings`, household members or the entry override),
      // never by the meal's. It reaches the prompt only through
      // `quantityPerServing`, which `componentsChanged` already compares — and
      // a real servings edit always arrives with the components, since that is
      // the divisor they are stored under.
      //
      // And by value, not by presence — the same "only on a real change" rule
      // the other two sites follow. The meal form PATCHes its whole payload on
      // every save (`src/components/household/use-meal-form.ts`), so a
      // `sourceUrl`-only edit still arrives carrying an unchanged `name`,
      // `timeMinutes` and component list. A presence check would fire on every
      // save and leave the per-field condition doing nothing.
      const tipsInputChanged =
        (name !== undefined && name !== existingMeal.name) ||
        (preparationNotes !== undefined && preparationNotes !== existingMeal.preparationNotes) ||
        (timeMinutes !== undefined && timeMinutes !== existingMeal.timeMinutes) ||
        componentsChanged

      if (tipsInputChanged) {
        await tx.mealPlanEntry.updateMany({
          where: { mealId: id, preparationTips: { not: null } },
          data: { preparationTips: null },
        })
      }

      // If components are provided, delete old and create new
      if (components) {
        await tx.mealComponent.deleteMany({
          where: { mealId: id },
        })

        await tx.mealComponent.createMany({
          data: components.map((c) => ({
            mealId: id,
            ingredientId: c.ingredientId,
            quantityPerServing: c.totalQuantity / componentServings,
            isVague: c.isVague ?? false,
            originalPhrase: c.originalPhrase ?? null,
          })),
        })
      }

      // Fetch updated meal with components
      return tx.meal.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          name: true,
          description: true,
          preparationNotes: true,
          sourceUrl: true,
          timeMinutes: true,
          kidFriendly: true,
          primaryProteinType: true,
          suitableFor: true,
          createdAt: true,
          updatedAt: true,
          components: {
            select: {
              ingredientId: true,
              quantityPerServing: true,
              isVague: true,
              originalPhrase: true,
              ingredient: {
                select: {
                  id: true,
                  name: true,
                  category: true,
                  defaultUnit: true,
                  gramsPerPiece: true,
                  calories: true,
                  protein: true,
                  carbs: true,
                  fat: true,
                  allergens: true,
                },
              },
            },
          },
          favoritedBy: {
            where: { householdId: membership.household.id },
            select: { id: true },
          },
        },
      })
    })

    const nutrition = meal.components.reduce(
      (acc, comp) => {
        if (comp.isVague) return acc
        const factor = comp.quantityPerServing / 100
        return {
          calories: acc.calories + comp.ingredient.calories * factor,
          protein: acc.protein + comp.ingredient.protein * factor,
          carbs: acc.carbs + comp.ingredient.carbs * factor,
          fat: acc.fat + comp.ingredient.fat * factor,
        }
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    )

    const allergens = [...new Set(meal.components.flatMap((comp) => comp.ingredient.allergens))]

    return NextResponse.json({
      id: meal.id,
      name: meal.name,
      description: meal.description,
      preparationNotes: meal.preparationNotes,
      sourceUrl: meal.sourceUrl,
      timeMinutes: meal.timeMinutes,
      kidFriendly: meal.kidFriendly,
      primaryProteinType: meal.primaryProteinType,
      suitableFor: meal.suitableFor,
      isCustom: true,
      isFavorite: meal.favoritedBy.length > 0,
      createdAt: meal.createdAt,
      updatedAt: meal.updatedAt,
      components: meal.components.map((comp) => ({
        ingredientId: comp.ingredientId,
        quantityPerServing: comp.quantityPerServing,
        isVague: comp.isVague,
        originalPhrase: comp.originalPhrase,
        ingredient: {
          id: comp.ingredient.id,
          name: comp.ingredient.name,
          category: comp.ingredient.category,
          defaultUnit: comp.ingredient.defaultUnit,
          gramsPerPiece: comp.ingredient.gramsPerPiece,
          calories: comp.ingredient.calories,
          protein: comp.ingredient.protein,
          carbs: comp.ingredient.carbs,
          fat: comp.ingredient.fat,
        },
      })),
      nutrition: {
        calories: Math.round(nutrition.calories),
        protein: Math.round(nutrition.protein),
        carbs: Math.round(nutrition.carbs),
        fat: Math.round(nutrition.fat),
      },
      allergens,
    })
  } catch (error) {
    captureApiError(error, { route: '/api/households/me/meals/[id]', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to update meal' }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const membership = await getHouseholdMembership(session.user.id)

    if (!membership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    // Verify meal exists and belongs to this household
    const existingMeal = await prisma.meal.findFirst({
      where: {
        id,
        householdId: membership.household.id,
        deletedAt: null,
      },
    })

    if (!existingMeal) {
      return NextResponse.json({ error: 'Meal not found' }, { status: 404 })
    }

    // Soft delete - set deletedAt timestamp
    await prisma.meal.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    captureApiError(error, { route: '/api/households/me/meals/[id]', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to delete meal' }, { status: 500 })
  }
}
