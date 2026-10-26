import 'server-only'
import { prisma } from '@/lib/prisma'
import type { Allergen, MealType, ProteinType } from '@/generated/prisma/enums'
import {
  ingredientTranslationsInclude,
  mealTranslationsInclude,
  translateIngredient,
  translateMeal,
} from '@/lib/i18n/content'
import { clearMealImage } from '@/lib/meal-images/invalidation'
import { presentMealImage } from '@/lib/meal-images/present'
import { gramsOf } from '@/lib/meal-images/prompt'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'
import { deriveProteinType } from '@/lib/meal-planning/protein'
import type { Locale } from '@/lib/i18n/locales'

/**
 * A household's own recipes, behind `GET` and `POST
 * /api/households/me/meals`, `GET`, `PATCH` and `DELETE
 * /api/households/me/meals/[id]` (HON-1210), and the `/recipes` server
 * prefetch. The routes own the session, the membership and body validation;
 * these functions own every query and every rule that acts on rows, and are
 * tested against a database in `household-meals.db.test.ts`.
 */

/**
 * Why a household meal read or write was refused. The routes map each one to
 * its status:
 *
 * - `mealNotFound`: no such meal in this household (404). A library meal and
 *   another household's meal answer this too, and so does a deleted one on
 *   update and delete, and so does one deleted longer ago than the restore
 *   window on restore.
 * - `mealNotDeleted`: a restore names a live recipe (409, HON-1336).
 * - `ingredientsNotFound`: a component names an ingredient that does not
 *   exist or belongs to another household, so its id is not revealed (400,
 *   HON-889). `missingIds` names them.
 */
export type HouseholdMealRefusal = 'mealNotFound' | 'mealNotDeleted' | 'ingredientsNotFound'

export class HouseholdMealError extends Error {
  constructor(
    readonly reason: HouseholdMealRefusal,
    readonly missingIds: string[] = [],
  ) {
    super(`Household meal refused: ${reason}`)
    this.name = 'HouseholdMealError'
  }
}

/** One validated component, as `mealComponentsSchema` outputs it. */
export interface HouseholdMealComponentInput {
  ingredientId: string
  /** The recipe's total, in the ingredient's default unit; 0 for a vague row. */
  totalQuantity: number
  isVague?: boolean
  originalPhrase?: string | null
}

/** The validated body of a create. */
export interface HouseholdMealCreateInput {
  name: string
  description?: string | null
  preparationNotes?: string | null
  sourceUrl?: string | null
  timeMinutes?: number | null
  kidFriendly: boolean
  suitableFor: MealType[]
  servings: number
  components: HouseholdMealComponentInput[]
}

/** The validated body of an update. A key that is present but null clears the field. */
export interface HouseholdMealPatch {
  name?: string
  description?: string | null
  preparationNotes?: string | null
  sourceUrl?: string | null
  timeMinutes?: number | null
  kidFriendly?: boolean
  suitableFor?: MealType[]
  servings?: number
  components?: HouseholdMealComponentInput[]
}

export interface ListHouseholdMealsOptions {
  householdId: string
  /** Resolved household locale (`resolveHouseholdLocale`). */
  locale: Locale
  search?: string | null
  cursor?: string | null
  limit?: number
  includeDeleted?: boolean
}

export const HOUSEHOLD_MEALS_DEFAULT_LIMIT = 30

/**
 * One page of a household's recipe library, newest first, keyset-paginated by
 * meal id. Shared by `GET /api/households/me/meals` and the `/recipes` server
 * prefetch (HON-770), so the page the server hydrates is the page the client
 * would have fetched.
 */
export async function listHouseholdMeals({
  householdId,
  locale,
  search = null,
  cursor = null,
  limit = HOUSEHOLD_MEALS_DEFAULT_LIMIT,
  includeDeleted = false,
}: ListHouseholdMealsOptions) {
  const baseQuery = {
    where: {
      householdId,
      ...(includeDeleted ? {} : { deletedAt: null }),
      ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
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
      imageUrl: true,
      imageStatus: true,
      imageHue: true,
      imagePromptVersion: true,
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
              measuredByVolume: true,
              pieceDisplay: true,
              gramsPerPiece: true,
              calories: true,
              protein: true,
              carbs: true,
              fat: true,
              allergens: true,
              proteinType: true,
              ...ingredientTranslationsInclude(locale),
            },
          },
        },
      },
      favoritedBy: {
        where: { householdId },
        select: { id: true },
      },
      ...mealTranslationsInclude(locale),
    },
    orderBy: [{ updatedAt: 'desc' as const }, { id: 'desc' as const }],
    take: limit + 1,
  }

  // Prisma 7 answers an unknown cursor with no rows, so the page is empty and
  // `nextCursor` is `null`; the client ends the list (HON-1232).
  const meals = await prisma.meal.findMany({
    ...baseQuery,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })

  const hasNext = meals.length > limit
  const pageMeals = hasNext ? meals.slice(0, limit) : meals
  const nextCursor = hasNext ? (pageMeals.at(-1)?.id ?? null) : null

  const mealsWithNutrition = pageMeals.map((meal) => {
    const nutrition = computeMealNutrition(meal.components)

    const allergens = [...new Set(meal.components.flatMap((comp) => comp.ingredient.allergens))]
    const translatedMeal = translateMeal(meal, locale)

    return {
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
      ...presentMealImage(meal),
      deletedAt: meal.deletedAt,
      createdAt: meal.createdAt,
      updatedAt: meal.updatedAt,
      components: meal.components.map((comp) => {
        const translatedIngredient = translateIngredient(comp.ingredient, locale)
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
            measuredByVolume: translatedIngredient.measuredByVolume,
            pieceDisplay: translatedIngredient.pieceDisplay,
            gramsPerPiece: translatedIngredient.gramsPerPiece,
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
    }
  })

  return { meals: mealsWithNutrition, nextCursor }
}

const INGREDIENT_NUTRITION_SELECT = {
  id: true,
  name: true,
  category: true,
  defaultUnit: true,
  measuredByVolume: true,
  pieceDisplay: true,
  gramsPerPiece: true,
  calories: true,
  protein: true,
  carbs: true,
  fat: true,
  allergens: true,
} as const

/** Rounded macros and the deduplicated allergens of a meal's components. */
function summarise(
  components: (Parameters<typeof computeMealNutrition>[0][number] & {
    ingredient: { allergens: Allergen[] }
  })[],
) {
  const nutrition = computeMealNutrition(components)
  return {
    nutrition: {
      calories: Math.round(nutrition.calories),
      protein: Math.round(nutrition.protein),
      carbs: Math.round(nutrition.carbs),
      fat: Math.round(nutrition.fat),
    },
    allergens: [...new Set(components.flatMap((comp) => comp.ingredient.allergens))],
  }
}

/**
 * The components' ingredients, if every one is global or the household's own.
 * Another household's ingredient reads as not found, so its id is not
 * revealed (HON-889). Repeated ids were already rejected by
 * `mealComponentsSchema`.
 */
async function findComponentIngredients(
  householdId: string,
  components: HouseholdMealComponentInput[],
) {
  const ingredientIds = components.map((c) => c.ingredientId)
  const ingredients = await prisma.ingredient.findMany({
    where: {
      id: { in: ingredientIds },
      OR: [{ householdId: null }, { householdId }],
    },
    select: {
      id: true,
      proteinType: true,
      protein: true,
      // For the image ranking in `updateHouseholdMeal`, which orders by grams
      // as the prompt does.
      defaultUnit: true,
      gramsPerPiece: true,
      densityGPerMl: true,
    },
  })

  if (ingredients.length !== ingredientIds.length) {
    const foundIds = new Set(ingredients.map((i) => i.id))
    throw new HouseholdMealError(
      'ingredientsNotFound',
      ingredientIds.filter((id) => !foundIds.has(id)),
    )
  }

  return new Map(ingredients.map((i) => [i.id, i]))
}

/**
 * The household's own recipe with this name, ignoring case and outer spaces,
 * or null. A deleted recipe and a shared catalogue recipe do not count, so
 * `create_meal` refuses only a name the household already uses (HON-1305).
 */
export async function findOwnMealByName(householdId: string, name: string) {
  return prisma.meal.findFirst({
    where: { householdId, deletedAt: null, name: { equals: name.trim(), mode: 'insensitive' } },
    select: { id: true, name: true },
  })
}

/**
 * Store a new recipe for the household, with each component's total divided
 * by `servings` and the primary protein derived from the ingredients. It
 * writes no translation rows: a household's recipe is stored in the language
 * it was typed in.
 */
export async function createHouseholdMeal(householdId: string, input: HouseholdMealCreateInput) {
  const { components, servings } = input
  const ingredientMap = await findComponentIngredients(householdId, components)

  const primaryProteinType = deriveProteinType(
    components.map((c) => ({
      quantityPerServing: c.totalQuantity / servings,
      ingredient: ingredientMap.get(c.ingredientId)!,
    })),
  )

  const meal = await prisma.meal.create({
    data: {
      name: input.name,
      description: input.description,
      preparationNotes: input.preparationNotes,
      sourceUrl: input.sourceUrl,
      timeMinutes: input.timeMinutes,
      kidFriendly: input.kidFriendly,
      suitableFor: input.suitableFor,
      servings,
      primaryProteinType,
      householdId,
      components: {
        create: components.map((c) => ({
          ingredientId: c.ingredientId,
          quantityPerServing: c.totalQuantity / servings,
          isVague: c.isVague ?? false,
          originalPhrase: c.originalPhrase ?? null,
        })),
      },
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
      createdAt: true,
      updatedAt: true,
      components: {
        select: {
          ingredientId: true,
          quantityPerServing: true,
          isVague: true,
          originalPhrase: true,
          ingredient: { select: INGREDIENT_NUTRITION_SELECT },
        },
      },
    },
  })

  return {
    id: meal.id,
    name: meal.name,
    description: meal.description,
    preparationNotes: meal.preparationNotes,
    sourceUrl: meal.sourceUrl,
    timeMinutes: meal.timeMinutes,
    kidFriendly: meal.kidFriendly,
    primaryProteinType: meal.primaryProteinType,
    suitableFor: meal.suitableFor,
    servings: meal.servings,
    isCustom: true,
    isFavorite: false,
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
        measuredByVolume: comp.ingredient.measuredByVolume,
        pieceDisplay: comp.ingredient.pieceDisplay,
        gramsPerPiece: comp.ingredient.gramsPerPiece,
      },
    })),
    ...summarise(meal.components),
  }
}

/**
 * One of the household's recipes in the household's locale, with its
 * nutrition and allergens. A deleted recipe is still returned, with its
 * `deletedAt`, so a past plan entry can open it.
 */
export async function getHouseholdMeal(householdId: string, mealId: string, locale: Locale) {
  const meal = await prisma.meal.findFirst({
    where: { id: mealId, householdId },
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
            select: { ...INGREDIENT_NUTRITION_SELECT, ...ingredientTranslationsInclude(locale) },
          },
        },
      },
      favoritedBy: {
        where: { householdId },
        select: { id: true },
      },
      ...mealTranslationsInclude(locale),
    },
  })

  if (!meal) throw new HouseholdMealError('mealNotFound')

  const translatedMeal = translateMeal(meal, locale)

  return {
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
      const translatedIngredient = translateIngredient(comp.ingredient, locale)
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
          measuredByVolume: translatedIngredient.measuredByVolume,
          pieceDisplay: translatedIngredient.pieceDisplay,
          gramsPerPiece: translatedIngredient.gramsPerPiece,
          calories: comp.ingredient.calories,
          protein: comp.ingredient.protein,
          carbs: comp.ingredient.carbs,
          fat: comp.ingredient.fat,
        },
      }
    }),
    ...summarise(meal.components),
  }
}

/** Ingredient ids, largest amount first; ties broken by id so the key is stable. */
function rankIngredients(rows: { id: string; amount: number }[]): string {
  return [...rows]
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id))
    .map((r) => r.id)
    .join(',')
}

/**
 * Change one of the household's live recipes. Clears the cached prep tips on
 * its plan entries and its image when, and only when, an input to that cache
 * changes by value. Returns the meal as the route sends it and the URL of the
 * image it cleared, which the caller deletes once this has committed: a
 * rolled-back edit must not have lost its image.
 */
export async function updateHouseholdMeal(
  householdId: string,
  id: string,
  patch: HouseholdMealPatch,
) {
  // Verify meal exists and belongs to this household, and carry the fields
  // the prep-tips and image invalidations compare by value. The components
  // are read inside the transaction instead, next to the divisor they are
  // scaled by.
  const existingMeal = await prisma.meal.findFirst({
    where: { id, householdId, deletedAt: null },
    select: {
      name: true,
      description: true,
      preparationNotes: true,
      timeMinutes: true,
      primaryProteinType: true,
    },
  })

  if (!existingMeal) throw new HouseholdMealError('mealNotFound')

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
  } = patch

  // This half only reads the ingredient table, so it stays out of the write
  // transaction below — a refusal here must not open one.
  const ingredientMap = components ? await findComponentIngredients(householdId, components) : null

  // Build update data
  const updateData: {
    name?: string
    description?: string | null
    preparationNotes?: string | null
    sourceUrl?: string | null
    timeMinutes?: number | null
    kidFriendly?: boolean
    suitableFor?: MealType[]
    servings?: number
    primaryProteinType?: ProteinType
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

    // Reading inside the transaction is not enough on its own: at Postgres's
    // default READ COMMITTED a plain read takes no lock, so two PATCHes can
    // both read the same divisor and rows before either writes — a
    // servings-only rescale would then overwrite a concurrent components
    // edit with rows computed from the stale read, or `update` a row the
    // other request just deleted. Lock the meal row first so every request
    // that reads-then-writes the components queues behind the last one.
    const readsComponents = components !== undefined || servings !== undefined
    if (readsComponents) {
      await tx.$queryRaw`SELECT 1 FROM "meal" WHERE "id" = ${id} FOR UPDATE`
    }

    const current = readsComponents
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

    if (components && current && ingredientMap) {
      componentServings = servings ?? current.servings

      // Derive primary protein type from ingredients
      const componentData = components.map((c) => ({
        quantityPerServing: c.totalQuantity / componentServings,
        ingredient: ingredientMap.get(c.ingredientId)!,
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
        const ingredient = ingredientMap.get(ingredientId)
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
    // (`MealPlanEntry.preparationTips`): `buildFullStepsPrompt` takes
    // `mealName`, `timeMinutes` and an ingredient list built from the
    // meal's components, and `preparationNotes` both feeds
    // `buildStepsFromNotesPrompt` and selects which of the two prompts
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
    // (`getEffectiveServings`, the members' portions or the entry override),
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
            ingredient: { select: INGREDIENT_NUTRITION_SELECT },
          },
        },
        favoritedBy: {
          where: { householdId },
          select: { id: true },
        },
      },
    })

    return { meal: updated, discardedImageUrl }
  })

  return {
    meal: {
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
          measuredByVolume: comp.ingredient.measuredByVolume,
          pieceDisplay: comp.ingredient.pieceDisplay,
          gramsPerPiece: comp.ingredient.gramsPerPiece,
          calories: comp.ingredient.calories,
          protein: comp.ingredient.protein,
          carbs: comp.ingredient.carbs,
          fat: comp.ingredient.fat,
        },
      })),
      ...summarise(meal.components),
    },
    discardedImageUrl,
  }
}

/**
 * Soft-delete one of the household's live recipes (HON-734). Plan entries keep
 * pointing at it, so a past entry still renders the meal. The image stays, so
 * the household can restore the recipe within `RECIPE_RESTORE_WINDOW_DAYS`
 * (HON-1336); the daily purge cron clears it after that. Answers with the
 * recipe's name and the delete time, so `delete_meal` can say until when it
 * can be restored (HON-1337).
 */
export async function deleteHouseholdMeal(householdId: string, id: string) {
  const existingMeal = await prisma.meal.findFirst({
    where: { id, householdId, deletedAt: null },
    select: { id: true },
  })

  if (!existingMeal) throw new HouseholdMealError('mealNotFound')

  const deletedAt = new Date()
  const meal = await prisma.meal.update({
    where: { id },
    data: { deletedAt },
    select: { id: true, name: true },
  })
  return { ...meal, deletedAt }
}
