import 'server-only'

import type { IngredientCategory, Unit } from '@/generated/prisma/enums'
import { ingredientTranslationsInclude, translateIngredient } from '@/lib/i18n/content'
import { findSynonym } from '@/lib/ingredient-aliases'
import { prisma } from '@/lib/prisma'

import { isProteinTypedCategory, type NewIngredientInput } from './new-ingredient'

export type { NewIngredientInput } from './new-ingredient'

/**
 * A household adds an ingredient the catalogue lacks, from an unmatched
 * ingredient row (HON-1263). The row is the household's own, in the name the
 * household typed, with no translation row and no promotion into the global
 * pool (docs/LOCALIZATION.md → Decided principles).
 */

/** The `IngredientResult` shape of `src/hooks/use-ingredient-search.ts`. */
export interface CreatedIngredient {
  id: string
  name: string
  category: IngredientCategory
  defaultUnit: Unit
  gramsPerPiece: number | null
  measuredByVolume: boolean
  calories: number
  protein: number
  carbs: number
  fat: number
}

/** Trimmed, spaces collapsed, lower case: the pool and the AI both use lowercase names. */
export function normaliseIngredientName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

const RESULT_SELECT = {
  id: true,
  name: true,
  category: true,
  defaultUnit: true,
  gramsPerPiece: true,
  measuredByVolume: true,
  calories: true,
  protein: true,
  carbs: true,
  fat: true,
} as const

/** Drops the translation rows the lookup selected. */
function toResult(row: CreatedIngredient): CreatedIngredient {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    defaultUnit: row.defaultUnit,
    gramsPerPiece: row.gramsPerPiece,
    measuredByVolume: row.measuredByVolume,
    calories: row.calories,
    protein: row.protein,
    carbs: row.carbs,
    fat: row.fat,
  }
}

/**
 * An existing ingredient the household means by `name`, or null. The user did
 * not find it in the search, so a row the catalogue already has is returned
 * rather than duplicated: a global name, a global row's name in the
 * household's locale ("sibul" is onion), another English name of a global row
 * ("all-purpose flour" is plain flour), then the household's own row. A near
 * miss ("tomatoe") is not caught; the search box above already shows those.
 */
export async function findExisting(householdId: string, locale: string, name: string) {
  const select = { ...RESULT_SELECT, ...ingredientTranslationsInclude(locale) }
  const named = (value: string) => ({ equals: value, mode: 'insensitive' as const })

  const global = await prisma.ingredient.findFirst({
    where: { householdId: null, name: named(name) },
    select,
  })
  if (global) return global

  const translated = await prisma.ingredient.findFirst({
    where: { householdId: null, translations: { some: { locale, name: named(name) } } },
    select,
  })
  if (translated) return translated

  const synonym = findSynonym(name)
  if (synonym) {
    const pooled = await prisma.ingredient.findFirst({
      where: { householdId: null, name: named(synonym) },
      select,
    })
    if (pooled) return pooled
  }

  return prisma.ingredient.findFirst({
    where: { householdId, name: named(name) },
    orderBy: { id: 'asc' },
    select: RESULT_SELECT,
  })
}

/**
 * The ingredient the household means by `input.name`: an existing one (see
 * `findExisting`), or a new household row. `Ingredient` has no unique
 * constraint on `(householdId, name)`, so the lookup is the guard.
 *
 * The name comes back in the household's locale, as the search returns it.
 */
export async function createHouseholdIngredient(
  householdId: string,
  locale: string,
  input: NewIngredientInput,
): Promise<CreatedIngredient> {
  const name = normaliseIngredientName(input.name)

  const existing = await findExisting(householdId, locale, name)
  if (existing) return toResult(translateIngredient(existing, locale))

  return prisma.ingredient.create({
    data: { householdId, ...ingredientData(input), subcategory: null, densityGPerMl: null },
    select: RESULT_SELECT,
  })
}

/**
 * The columns a household sets for its own row, shared by create and edit
 * (HON-1264): a protein type only for a protein-typed category, grams per piece
 * only for a piece unit, each allergen once. A household row is never measured
 * by volume.
 */
export function ingredientData(input: NewIngredientInput) {
  return {
    name: normaliseIngredientName(input.name),
    category: input.category,
    proteinType: isProteinTypedCategory(input.category) ? (input.proteinType ?? null) : null,
    defaultUnit: input.defaultUnit,
    gramsPerPiece: input.defaultUnit === 'piece' ? (input.gramsPerPiece ?? null) : null,
    allergens: [...new Set(input.allergens)],
    calories: input.calories,
    protein: input.protein,
    carbs: input.carbs,
    fat: input.fat,
    fiber: input.fiber ?? null,
    measuredByVolume: false,
  }
}
