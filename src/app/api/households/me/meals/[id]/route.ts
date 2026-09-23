import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership } from '@/lib/household'
import { deriveProteinType } from '@/lib/meal-planning/protein'
import type { ComponentForProtein } from '@/lib/meal-planning/protein'
import {
  ingredientTranslationsInclude,
  mealTranslationsInclude,
  translateIngredient,
  translateMeal,
} from '@/lib/i18n/content'
import { captureApiError } from '@/lib/errors'
import { clearMealImage } from '@/lib/meal-images/invalidation'
import { discardMealImage } from '@/lib/meal-images/storage'
import { gramsOf } from '@/lib/meal-images/prompt'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'

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

/** Ingredient ids, largest amount first; ties broken by id so the key is stable. */
function rankIngredients(rows: { id: string; amount: number }[]): string {
  return [...rows]
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id))
    .map((r) => r.id)
    .join(',')
}

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

    const nutrition = computeMealNutrition(meal.components)

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

    // Verify meal exists and belongs to this household, and carry the fields
    // the prep-tips and image invalidations compare by value. The components
    // are read inside the transaction instead, next to the divisor they are
    // scaled by.
    const existingMeal = await prisma.meal.findFirst({
      where: {
        id,
        householdId: membership.household.id,
        deletedAt: null,
      },
      select: {
        name: true,
        description: true,
        preparationNotes: true,
        timeMinutes: true,
        primaryProteinType: true,
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

    // If components are being updated, verify all ingredients exist. This half
    // only reads the global ingredient table, so it stays out of the write
    // transaction below — a 400 here must not open one.
    let ingredientMap: Map<
      string,
      ComponentForProtein['ingredient'] & {
        id: string
        defaultUnit: string
        gramsPerPiece: number | null
        densityGPerMl: number | null
      }
    > | null = null

    if (components) {
      const ingredientIds = components.map((c) => c.ingredientId)

      // A repeated id makes `findMany` return one row for two components, so
      // the existence check below fires with an empty `missingIds` — a 400 that
      // names nothing. Diagnose it here instead. The guard itself is load-
      // bearing either way: `createMany` would hit
      // `@@unique([mealId, ingredientId])` and answer 500.
      const seen = new Set<string>()
      const duplicates = new Set<string>()

      for (const ingredientId of ingredientIds) {
        if (seen.has(ingredientId)) duplicates.add(ingredientId)
        else seen.add(ingredientId)
      }

      const duplicateIds = [...duplicates]

      if (duplicateIds.length > 0) {
        return NextResponse.json(
          { error: 'Duplicate ingredients in components', duplicateIds },
          { status: 400 },
        )
      }

      const ingredients = await prisma.ingredient.findMany({
        where: { id: { in: ingredientIds } },
        select: {
          id: true,
          proteinType: true,
          protein: true,
          // For the image ranking below, which orders by grams as the prompt does.
          defaultUnit: true,
          gramsPerPiece: true,
          densityGPerMl: true,
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

      ingredientMap = new Map(ingredients.map((i) => [i.id, i]))
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
      primaryProteinType?: typeof existingMeal.primaryProteinType
    } = {}

    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (preparationNotes !== undefined) updateData.preparationNotes = preparationNotes
    if (sourceUrl !== undefined) updateData.sourceUrl = sourceUrl
    if (timeMinutes !== undefined) updateData.timeMinutes = timeMinutes
    if (kidFriendly !== undefined) updateData.kidFriendly = kidFriendly
    if (suitableFor !== undefined) updateData.suitableFor = suitableFor
    if (servings !== undefined) updateData.servings = servings

    // Use transaction to update meal and components atomically
    const { meal, discardedImageUrl } = await prisma.$transaction(async (tx) => {
      // `components` and `servings` are independently optional in the schema,
      // so a components-only PATCH has to scale against something. The meal's
      // own stored `servings` is that divisor — it is what the rows already on
      // disk are kept under, and `Meal.servings` is non-nullable, so it always
      // exists. Gating the component path on both fields instead dropped the
      // whole edit and still answered 200 with the unchanged list (HON-701).
      //
      // Read here rather than from `existingMeal` above: that read happens
      // before the transaction opens, and once the divisor decides what gets
      // *written*, a concurrent `PATCH {servings}` landing in between would
      // store the rows under a divisor the meal no longer uses — 800g sent,
      // 1600g stored, no error either side. The component comparison feeding
      // `componentsChanged` reads the same stale-or-fresh pair, so it moves in
      // with it.
      //
      // Both are only meaningful under `components`; the `createMany` further
      // down reads `componentServings` behind that same condition.
      let componentServings = 0
      let componentsChanged = false
      let imageComponentsChanged = false

      const current =
        components || servings !== undefined
          ? await tx.meal.findUniqueOrThrow({
              where: { id },
              select: {
                servings: true,
                components: { select: { ingredientId: true, quantityPerServing: true } },
              },
            })
          : null

      // A bare `servings` edit keeps the recipe's total, not its per-serving
      // amounts: every reader — the edit form, the shopping list, the imagine
      // review — reconstructs a total as `quantityPerServing * Meal.servings`,
      // so leaving the rows put would silently grow 600g of chicken over 4
      // servings into 900g over 6, and the form would save that back (HON-712).
      // Restate each row under the new divisor instead. Vague rows are stored
      // at 0 and have nothing to restate, so a meal made only of those — or a
      // PATCH resending the stored value — moves no quantity at all.
      const rescaledComponents =
        !components && current && servings !== undefined && servings !== current.servings
          ? current.components
              .filter((c) => c.quantityPerServing !== 0)
              .map((c) => ({
                ingredientId: c.ingredientId,
                quantityPerServing: (c.quantityPerServing * current.servings) / servings,
              }))
          : []

      if (components && current) {
        componentServings = servings ?? current.servings

        // Derive primary protein type from ingredients
        const componentData = components.map((c) => ({
          quantityPerServing: c.totalQuantity / componentServings,
          ingredient: ingredientMap!.get(c.ingredientId)!,
        }))
        updateData.primaryProteinType = deriveProteinType(componentData)

        // The prep-tips prompt renders one line per component from its
        // ingredient and its `quantityPerServing` — the same division applied
        // below — so those two fields are the whole of what a tips
        // regeneration would see. `isVague` and `originalPhrase` are not in
        // the prompt, and a vague flip zeroes `totalQuantity` in the schema
        // transform, so it shows up here as a quantity change anyway.
        const existingQuantities = new Map(
          current.components.map((c) => [c.ingredientId, c.quantityPerServing]),
        )
        componentsChanged =
          components.length !== current.components.length ||
          components.some(
            (c) => existingQuantities.get(c.ingredientId) !== c.totalQuantity / componentServings,
          )

        // The image prompt sees the ingredients ranked largest amount first
        // (HON-733's V3), not their amounts. A servings edit from the form
        // resends unchanged totals over a new divisor — every per-serving
        // quantity moves, the ranking does not — so it must not cost the
        // meal its illustration.
        //
        // Ranked by grams through the prompt's own `gramsOf` (HON-735): raw
        // quantities put 1 egg below 2 g of cheese, so this would both clear
        // images the prompt would redraw identically and keep ones it would
        // not. `ingredientMap` holds only the incoming ids, which is enough —
        // when the id sets differ the two keys differ whatever the amounts.
        const grams = (ingredientId: string, quantity: number) => {
          const ingredient = ingredientMap!.get(ingredientId)
          return gramsOf({
            quantity,
            unit: ingredient?.defaultUnit ?? 'g',
            gramsPerPiece: ingredient?.gramsPerPiece,
            densityGPerMl: ingredient?.densityGPerMl,
          })
        }
        imageComponentsChanged =
          rankIngredients(
            current.components.map((c) => ({
              id: c.ingredientId,
              amount: grams(c.ingredientId, c.quantityPerServing),
            })),
          ) !==
          rankIngredients(
            components.map((c) => ({
              id: c.ingredientId,
              amount: grams(c.ingredientId, c.totalQuantity),
            })),
          )
      }

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
      // `quantityPerServing`: through `componentsChanged` when the edit comes
      // with components, and through the rows restated above when it comes
      // alone. A servings edit that moves no row leaves the prompt byte-
      // identical and keeps the tips.
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
        componentsChanged ||
        rescaledComponents.length > 0

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

      // Sequential on purpose: an interactive transaction runs on one
      // connection, so concurrent queries on it would only queue anyway.
      for (const c of rescaledComponents) {
        await tx.mealComponent.update({
          where: { mealId_ingredientId: { mealId: id, ingredientId: c.ingredientId } },
          data: { quantityPerServing: c.quantityPerServing },
        })
      }

      // The meal image depicts the meal's content, so it goes stale on the
      // same by-value rule as the tips above, over a different field set:
      // `description` feeds the image but not the tips, `timeMinutes` the
      // reverse. Components compare by ingredient ranking rather than
      // `componentsChanged`, so a servings edit keeps the image (HON-734).
      const imageInputChanged =
        (name !== undefined && name !== existingMeal.name) ||
        (description !== undefined && description !== existingMeal.description) ||
        (preparationNotes !== undefined && preparationNotes !== existingMeal.preparationNotes) ||
        imageComponentsChanged

      const discardedImageUrl = imageInputChanged ? await clearMealImage(tx, id) : null

      // Fetch updated meal with components
      const updated = await tx.meal.findUniqueOrThrow({
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

      return { meal: updated, discardedImageUrl }
    })

    // After commit: a rolled-back edit must not have lost its image.
    await discardMealImage(discardedImageUrl, '/api/households/me/meals/[id]')

    const nutrition = computeMealNutrition(meal.components)

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

    // Soft delete - set deletedAt timestamp, and drop the image with it
    // (HON-734). Past plan entries can still render a soft-deleted meal; they
    // do so without its illustration.
    const discardedImageUrl = await prisma.$transaction(async (tx) => {
      await tx.meal.update({
        where: { id },
        data: { deletedAt: new Date() },
      })

      return clearMealImage(tx, id)
    })

    await discardMealImage(discardedImageUrl, '/api/households/me/meals/[id]')

    return NextResponse.json({ success: true })
  } catch (error) {
    captureApiError(error, { route: '/api/households/me/meals/[id]', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to delete meal' }, { status: 500 })
  }
}
