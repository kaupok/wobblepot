import { isDefaultLocale, isKnownLocale } from './locales'

/**
 * Whether `locale` gets the translation overlay: a known, non-default locale.
 * An unknown tag (a locale rolled back out of `KNOWN_LOCALES`) reads as the
 * default, so a caller that skipped `resolveHouseholdLocale` still renders
 * English rather than the rolled-back locale's rows (HON-921).
 */
function needsTranslation(locale: string | null | undefined): locale is string {
  return !isDefaultLocale(locale) && isKnownLocale(locale as string)
}

type IngredientTranslationFields = {
  locale: string
  name: string
}

type MealTranslationFields = {
  locale: string
  name: string
  description: string | null
  preparationNotes: string | null
}

type WithIngredientTranslations<T> = T & {
  translations?: IngredientTranslationFields[]
}

type WithMealTranslations<T> = T & {
  translations?: MealTranslationFields[]
}

type IngredientTranslationsInclude = {
  translations: {
    where: { locale: string }
    take: 1
    select: { locale: true; name: true }
  }
}

type MealTranslationsInclude = {
  translations: {
    where: { locale: string }
    take: 1
    select: {
      locale: true
      name: true
      description: true
      preparationNotes: true
    }
  }
}

/**
 * Prisma fragment for ingredient translations. Returns an empty object for
 * the default locale so callers can spread it unconditionally inside either
 * a `select` or `include` block without paying for an extra JOIN when no
 * translation is needed.
 *
 * Usage (select context):
 *   prisma.ingredient.findMany({
 *     select: { id: true, name: true, ...ingredientTranslationsInclude(locale) }
 *   })
 *
 * Usage (include context):
 *   prisma.ingredient.findMany({
 *     include: { ...ingredientTranslationsInclude(locale) }
 *   })
 */
export function ingredientTranslationsInclude(
  locale: string | null | undefined,
): IngredientTranslationsInclude | Record<string, never> {
  if (!needsTranslation(locale)) return {}
  return {
    translations: {
      where: { locale },
      take: 1,
      select: { locale: true, name: true },
    },
  }
}

/**
 * Prisma fragment for meal translations. See `ingredientTranslationsInclude`.
 */
export function mealTranslationsInclude(
  locale: string | null | undefined,
): MealTranslationsInclude | Record<string, never> {
  if (!needsTranslation(locale)) return {}
  return {
    translations: {
      where: { locale },
      take: 1,
      select: {
        locale: true,
        name: true,
        description: true,
        preparationNotes: true,
      },
    },
  }
}

/**
 * Coalesce a translation onto an ingredient. Returns the same shape with
 * `name` overridden when a matching translation exists. English (default) and
 * unknown locales pass through unchanged.
 */
export function translateIngredient<T extends { name: string }>(
  ingredient: WithIngredientTranslations<T>,
  locale: string | null | undefined,
): T {
  if (!needsTranslation(locale)) return ingredient
  const translation = ingredient.translations?.find((t) => t.locale === locale)
  if (!translation) return ingredient
  return { ...ingredient, name: translation.name }
}

export function translateIngredients<T extends { name: string }>(
  ingredients: WithIngredientTranslations<T>[],
  locale: string | null | undefined,
): T[] {
  if (!needsTranslation(locale)) return ingredients
  return ingredients.map((i) => translateIngredient(i, locale))
}

/**
 * Coalesce a translation onto a meal. Per-field fallback: an Estonian
 * translation that omits `description` will fall back to the English
 * description rather than blanking the field.
 */
export function translateMeal<
  T extends { name: string; description?: string | null; preparationNotes?: string | null },
>(meal: WithMealTranslations<T>, locale: string | null | undefined): T {
  if (!needsTranslation(locale)) return meal
  const translation = meal.translations?.find((t) => t.locale === locale)
  if (!translation) return meal
  return {
    ...meal,
    name: translation.name,
    description: translation.description ?? meal.description ?? null,
    preparationNotes: translation.preparationNotes ?? meal.preparationNotes ?? null,
  }
}

export function translateMeals<
  T extends { name: string; description?: string | null; preparationNotes?: string | null },
>(meals: WithMealTranslations<T>[], locale: string | null | undefined): T[] {
  if (!needsTranslation(locale)) return meals
  return meals.map((m) => translateMeal(m, locale))
}

export { isDefaultLocale }
