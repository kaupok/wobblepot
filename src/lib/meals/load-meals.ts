import 'server-only'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import type { Allergen, MealType, ProteinType } from '@/generated/prisma/enums'
import {
  ingredientTranslationsInclude,
  isDefaultLocale,
  mealTranslationsInclude,
  translateIngredient,
  translateMeal,
} from '@/lib/i18n/content'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { presentMealImage } from '@/lib/meal-images/present'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'
import { getExcludedIngredientIds } from '@/lib/household/excluded-ingredients'
import { getTodayInTimezone } from '@/lib/meal-planning/dates'
import {
  compareLongestSinceCooked,
  loadMealHistory,
  NO_HISTORY,
  type MealHistory,
} from '@/lib/meal-plans/meal-history'

export const MEALS_DEFAULT_LIMIT = 20
export const MEALS_MAX_LIMIT = 50
/**
 * A name matches the search when it contains it as a substring or, for a
 * search of FUZZY_MIN_LENGTH characters or more, when its pg_trgm score
 * reaches FUZZY_THRESHOLD. The fuzzy half forgives typos ("brocoli" scores
 * 0.7 against "broccoli", "chiken" 0.5 against "chicken").
 *
 * pg_trgm pads each word with two leading spaces and one trailing space, so an
 * n-letter word has n + 1 trigrams and the first ones are its opening letters:
 * "oat" → "  o", " oa", "oat", "at ". A name whose word merely starts with the
 * same k letters shares k trigrams, and `word_similarity()` scores that
 * k / (n + 1). At the old threshold of 0.25 one shared first letter was enough
 * for "oat" (1/4), so it matched every meal with onion or olive oil (HON-942).
 *
 * At 0.5 a shared prefix has to cover half the search: two letters of a
 * four-letter search score 2/5 and fail ("kaer" no longer matches every
 * "kana" and "kartul"). A three-letter search would still pass on two letters
 * (2/4), so below four characters only the substring match applies. Lowering
 * either constant brings the leak back.
 */
const FUZZY_THRESHOLD = 0.5
const FUZZY_MIN_LENGTH = 4
// Cap search results to prevent loading too many meals into memory. A one- or
// two-letter search matches by substring and can hit nearly every meal the
// household sees (271 global meals in 2026-10), so keep the cap above the
// library size: matches past it are dropped and `total` comes back short.
const FUZZY_SEARCH_CAP = 500

interface FuzzyMealMatch {
  id: string
  similarity: number
}

/** An ILIKE pattern matching names that contain `search`, its `%`, `_` and `\` taken literally. */
function likePattern(search: string) {
  return `%${search.replace(/[\\%_]/g, '\\$&')}%`
}

/**
 * The meals a household may see: the shared catalogue plus its own recipes,
 * never a deleted one. `loadMeals` and the MCP `get_meal` tool (HON-1151)
 * both filter through this, so a meal the list hides cannot be opened by id.
 */
export function visibleMealWhere(householdId: string): Prisma.MealWhereInput {
  return { deletedAt: null, OR: [{ householdId: null }, { householdId }] }
}

export type MealSource = 'all' | 'system' | 'custom' | 'favorites'

/** `longestSinceCooked`: the meal the household has gone longest without first (HON-1388). */
export type MealOrder = 'longestSinceCooked'

export interface LoadMealsHousehold {
  id: string
  locale: string
  /** Decides "today" for each meal's cooking history. */
  timezone: string
  preferences: { allergensToAvoid: Allergen[]; excludedIngredients: string[] } | null
}

export interface LoadMealsFilters {
  mealType?: MealType | null
  proteinType?: ProteinType | null
  kidFriendly?: boolean | null
  search?: string | null
  source?: MealSource | null
  /** Unset is alphabetical. A search keeps its relevance order either way. */
  order?: MealOrder | null
  /** Clamped to 1..MEALS_MAX_LIMIT. */
  limit?: number
  offset?: number
}

export type LoadMealsResult = Awaited<ReturnType<typeof loadMeals>>

/**
 * One page of the meals a household can plan, in the shape `GET /api/meals`
 * returns. The route and the MCP `list_meals` tool (HON-1151) both read
 * through this.
 *
 * The household's allergens and excluded ingredients are hard filters, and
 * names follow the household's locale, never Accept-Language: it decides which
 * translated names the search matches and the order of the alphabetical list
 * (HON-911).
 */
export async function loadMeals(household: LoadMealsHousehold, filters: LoadMealsFilters = {}) {
  const locale = resolveHouseholdLocale(household)
  const translate = !isDefaultLocale(locale)

  const mealType = filters.mealType ?? null
  const proteinType = filters.proteinType ?? null
  const kidFriendly = filters.kidFriendly ?? null
  const search = filters.search?.trim() || null
  const source = filters.source ?? null
  const limit = Math.min(Math.max(1, filters.limit ?? MEALS_DEFAULT_LIMIT), MEALS_MAX_LIMIT)
  const offset = Math.max(0, filters.offset ?? 0)

  // Preferences for allergen filtering
  const allergensToAvoid = household.preferences?.allergensToAvoid ?? []
  // Resolved now, not the stored ids, so a household's old tags follow the current rule (HON-1321).
  const excludedIngredientIds = await getExcludedIngredientIds(
    household.id,
    household.preferences?.excludedIngredients ?? [],
  )

  // Get favorite meal IDs for this household
  const favoriteMealIds =
    source === 'favorites'
      ? (
          await prisma.favoriteMeal.findMany({
            where: { householdId: household.id },
            select: { mealId: true },
          })
        ).map((f) => f.mealId)
      : []

  // Build source filter
  const sourceFilter: Prisma.MealWhereInput =
    source === 'system'
      ? { householdId: null }
      : source === 'custom'
        ? { householdId: household.id }
        : source === 'favorites'
          ? { id: { in: favoriteMealIds } }
          : // 'all' or null: everything `visibleMealWhere` lets through
            {}

  // When search is provided, use fuzzy matching to get meal IDs
  // Searches both meal name AND ingredient names, in English and, for a
  // non-default locale, in the household's language too (HON-911)
  // Limited to FUZZY_SEARCH_CAP results to prevent loading too many into memory
  let fuzzyMealMatches: FuzzyMealMatch[] | null = null
  if (search) {
    const mealNames = translate ? [Prisma.sql`m.name`, Prisma.sql`mt.name`] : [Prisma.sql`m.name`]
    const ingredientNames = translate
      ? [Prisma.sql`i.name`, Prisma.sql`it.name`]
      : [Prisma.sql`i.name`]
    const mealTranslationJoin = translate
      ? Prisma.sql`LEFT JOIN "meal_translation" mt ON mt."mealId" = m.id AND mt.locale = ${locale}`
      : Prisma.empty
    const ingredientTranslationJoin = translate
      ? Prisma.sql`LEFT JOIN "ingredient_translation" it ON it."ingredientId" = i.id AND it.locale = ${locale}`
      : Prisma.empty
    // A name matches when it contains the search, or (from FUZZY_MIN_LENGTH)
    // when its similarity() or word_similarity() reaches FUZZY_THRESHOLD.
    // A substring match scores 1 + similarity, above any fuzzy score, so it
    // sorts first and the closer of two substring matches still leads. A
    // missing translation scores NULL, which GREATEST skips and OR treats as
    // no match, so the English name still decides for that row.
    const pattern = likePattern(search)
    const fuzzy = search.length >= FUZZY_MIN_LENGTH
    const scores = (names: Prisma.Sql[]) =>
      names.map(
        (n) => Prisma.sql`GREATEST(
          CASE WHEN ${n} ILIKE ${pattern} THEN 1 + similarity(${n}, ${search}) END,
          similarity(${n}, ${search}),
          word_similarity(${search}, ${n})
        )`,
      )
    const matches = (names: Prisma.Sql[]) =>
      Prisma.join(
        names.map((n) =>
          fuzzy
            ? Prisma.sql`(${n} ILIKE ${pattern} OR similarity(${n}, ${search}) >= ${FUZZY_THRESHOLD} OR word_similarity(${search}, ${n}) >= ${FUZZY_THRESHOLD})`
            : Prisma.sql`${n} ILIKE ${pattern}`,
        ),
        ' OR ',
      )

    fuzzyMealMatches = await prisma.$queryRaw<FuzzyMealMatch[]>`
      SELECT DISTINCT m.id,
        GREATEST(
          ${Prisma.join(scores(mealNames))},
          COALESCE((
            SELECT MAX(GREATEST(${Prisma.join(scores(ingredientNames))}))
            FROM "meal_component" mc
            JOIN "ingredient" i ON i.id = mc."ingredientId"
            ${ingredientTranslationJoin}
            WHERE mc."mealId" = m.id
          ), 0)
        ) as similarity
      FROM "meal" m
      ${mealTranslationJoin}
      -- Only meals the Prisma filter below can keep, so deleted meals and
      -- those of other households do not use up FUZZY_SEARCH_CAP
      WHERE m."deletedAt" IS NULL
      AND (m."householdId" IS NULL OR m."householdId" = ${household.id})
      AND (
        ${matches(mealNames)}
        OR EXISTS (
          SELECT 1 FROM "meal_component" mc
          JOIN "ingredient" i ON i.id = mc."ingredientId"
          ${ingredientTranslationJoin}
          WHERE mc."mealId" = m.id
          AND (${matches(ingredientNames)})
        )
      )
      ORDER BY similarity DESC
      LIMIT ${FUZZY_SEARCH_CAP}
    `
  }

  // Build where clause
  const where: Prisma.MealWhereInput = {
    AND: [
      // The shared catalogue plus this household's own recipes, never deleted
      visibleMealWhere(household.id),
      // Source filter, inside that set
      sourceFilter,
      // Filter by meal type if specified
      ...(mealType ? [{ suitableFor: { has: mealType } }] : []),
      // Filter by protein type if specified
      ...(proteinType ? [{ primaryProteinType: proteinType }] : []),
      // Filter by kid-friendly if specified
      ...(kidFriendly !== null ? [{ kidFriendly }] : []),
      // Fuzzy search filter: only include meals matching the search
      ...(fuzzyMealMatches ? [{ id: { in: fuzzyMealMatches.map((m) => m.id) } }] : []),
      // Hard filter: allergens - exclude meals with any allergen-containing ingredients
      ...(allergensToAvoid.length > 0
        ? [
            {
              NOT: {
                components: {
                  some: {
                    ingredient: {
                      allergens: { hasSome: allergensToAvoid },
                    },
                  },
                },
              },
            },
          ]
        : []),
      // Hard filter: excluded ingredients
      ...(excludedIngredientIds.length > 0
        ? [
            {
              NOT: {
                components: {
                  some: { ingredientId: { in: excludedIngredientIds } },
                },
              },
            },
          ]
        : []),
    ],
  }

  // Get total count for pagination
  const total = await prisma.meal.count({ where })

  // Build orderBy - use similarity ordering when searching, otherwise alphabetical
  const fuzzyOrderMap = fuzzyMealMatches
    ? new Map(fuzzyMealMatches.map((m) => [m.id, m.similarity]))
    : null

  const today = getTodayInTimezone(household.timezone)
  const byHistory = filters.order === 'longestSinceCooked' && !fuzzyOrderMap
  let history: Map<string, MealHistory> | null = null
  const historyOf = (id: string) => history?.get(id) ?? NO_HISTORY

  // Prisma can only order by the English `name`. For a translated locale,
  // sort the matching meals' display names with the locale's collation
  // (Estonian puts š, z, ž after s and õ, ä, ö, ü after w) and fetch just
  // that page (HON-911). The history order sorts here too, before the name,
  // because it needs every matching meal's history (HON-1388).
  let inMemoryPageIds: string[] | null = null
  if (!fuzzyOrderMap && (translate || byHistory)) {
    const collator = new Intl.Collator(locale)
    const names = (
      await prisma.meal.findMany({
        where,
        select: { id: true, name: true, ...mealTranslationsInclude(locale) },
      })
    ).map((meal) => translateMeal(meal, locale))
    if (byHistory) {
      history = await loadMealHistory(
        household.id,
        names.map((meal) => meal.id),
        today,
      )
    }
    inMemoryPageIds = names
      .sort(
        (a, b) =>
          (byHistory ? compareLongestSinceCooked(historyOf(a.id), historyOf(b.id)) : 0) ||
          collator.compare(a.name, b.name) ||
          // The id tie-break keeps pages stable when two meals share a name
          a.id.localeCompare(b.id),
      )
      .slice(offset, offset + limit)
      .map((meal) => meal.id)
  }

  // Fetch meals with pagination
  const mealsRaw = await prisma.meal.findMany({
    where: inMemoryPageIds ? { AND: [where, { id: { in: inMemoryPageIds } }] } : where,
    select: {
      id: true,
      name: true,
      description: true,
      preparationNotes: true,
      timeMinutes: true,
      kidFriendly: true,
      primaryProteinType: true,
      suitableFor: true,
      householdId: true,
      imageUrl: true,
      imageStatus: true,
      imageHue: true,
      imagePromptVersion: true,
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
              ...ingredientTranslationsInclude(locale),
            },
          },
        },
      },
      favoritedBy: {
        where: { householdId: household.id },
        select: { id: true },
      },
      ...mealTranslationsInclude(locale),
    },
    // When searching, we need to fetch all matching meals and sort in memory
    // because Prisma doesn't support ordering by a computed value from raw SQL.
    // A page sorted in memory is already chosen and ordered by `inMemoryPageIds`.
    ...(fuzzyOrderMap || inMemoryPageIds ? {} : { orderBy: { name: 'asc' } }),
    skip: fuzzyOrderMap || inMemoryPageIds ? 0 : offset,
    take: fuzzyOrderMap || inMemoryPageIds ? undefined : limit,
  })

  // Sort by similarity if searching, then apply pagination
  let sortedMeals = mealsRaw
  if (inMemoryPageIds) {
    const position = new Map(inMemoryPageIds.map((id, index) => [id, index]))
    sortedMeals = [...mealsRaw].sort(
      (a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0),
    )
  } else if (fuzzyOrderMap) {
    sortedMeals = [...mealsRaw].sort((a, b) => {
      const simA = fuzzyOrderMap.get(a.id) ?? 0
      const simB = fuzzyOrderMap.get(b.id) ?? 0
      return simB - simA // Descending similarity
    })
    sortedMeals = sortedMeals.slice(offset, offset + limit)
  }

  history ??= await loadMealHistory(
    household.id,
    sortedMeals.map((meal) => meal.id),
    today,
  )

  // Compute nutrition per serving for each meal and format components
  const meals = sortedMeals.map((meal) => {
    const nutrition = computeMealNutrition(meal.components)

    const translatedMeal = translateMeal(meal, locale)

    // Format components for AlternativeCard compatibility
    const components = meal.components.map((comp) => {
      const translatedIngredient = translateIngredient(comp.ingredient, locale)
      return {
        ingredientId: comp.ingredientId,
        quantityPerServing: comp.quantityPerServing,
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
    })

    return {
      id: translatedMeal.id,
      name: translatedMeal.name,
      description: translatedMeal.description,
      // The picker's cook view shows them (HON-1352).
      preparationNotes: translatedMeal.preparationNotes,
      timeMinutes: translatedMeal.timeMinutes,
      kidFriendly: translatedMeal.kidFriendly,
      primaryProteinType: translatedMeal.primaryProteinType,
      suitableFor: translatedMeal.suitableFor,
      isCustom: meal.householdId !== null,
      isFavorite: meal.favoritedBy.length > 0,
      ...presentMealImage(meal),
      ...historyOf(meal.id),
      components,
      nutrition: {
        calories: Math.round(nutrition.calories),
        protein: Math.round(nutrition.protein),
        carbs: Math.round(nutrition.carbs),
        fat: Math.round(nutrition.fat),
      },
    }
  })

  return {
    meals,
    total,
    hasMore: offset + meals.length < total,
  }
}
