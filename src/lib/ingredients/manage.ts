import 'server-only'

import type { Prisma } from '@/generated/prisma/client'
import { restoreWindowStart } from '@/lib/deleted-household-meals'
import { resolveProteinType } from '@/lib/meal-planning/protein'
import { prisma } from '@/lib/prisma'

import { findExisting, ingredientData, normaliseIngredientName } from './create'
import type { HouseholdIngredient, IngredientUses } from './household-ingredient'
import type { NewIngredientInput } from './new-ingredient'

export type { HouseholdIngredient, IngredientUses } from './household-ingredient'

/**
 * The household's own ingredients, the rows it added from an unmatched recipe
 * row (HON-1263), and their edit and delete (HON-1264). A global row
 * (`householdId: null`) or another household's row is "not found" here, so a
 * caller cannot tell it exists.
 */

const ROW_SELECT = {
  id: true,
  name: true,
  category: true,
  proteinType: true,
  defaultUnit: true,
  gramsPerPiece: true,
  allergens: true,
  calories: true,
  protein: true,
  carbs: true,
  fat: true,
  fiber: true,
} as const satisfies Prisma.IngredientSelect

/**
 * Every relation that holds the row's id, so a delete would fail or cascade.
 * `components` counts live recipes only: a deleted recipe's components are
 * counted apart, by `deletedMealComponents` (HON-1325).
 */
const USES_COUNT = {
  _count: {
    select: {
      components: { where: { meal: { deletedAt: null } } },
      pantryItems: true,
      customShoppingItems: true,
      fridgeMealItems: true,
      dayExtras: true,
      replacedInEntries: true,
      usedInEntryChanges: true,
    },
  },
} as const

type UsesCount = { _count: Record<keyof (typeof USES_COUNT)['_count']['select'], number> }

/**
 * The row's components on deleted recipes that a meal plan entry still uses
 * (`inPlan`), or that none does. A recipe holds an ingredient once, so a
 * component count is a recipe count.
 */
function deletedMealComponents(id: string, inPlan: boolean): Prisma.MealComponentWhereInput {
  const planEntries = inPlan ? { some: {} } : { none: {} }
  return { ingredientId: id, meal: { deletedAt: { not: null }, planEntries } }
}

function toUses({ _count: c }: UsesCount, deletedMealsInPlan: number): IngredientUses {
  return {
    meals: c.components,
    deletedMealsInPlan,
    pantry: c.pantryItems,
    shoppingList: c.customShoppingItems,
    mealPlan: c.fridgeMealItems + c.replacedInEntries + c.usedInEntryChanges,
    extras: c.dayExtras,
  }
}

const isInUse = (uses: IngredientUses) => Object.values(uses).some((count) => count > 0)

export async function listHouseholdIngredients(
  householdId: string,
): Promise<HouseholdIngredient[]> {
  return prisma.ingredient.findMany({
    where: { householdId },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: ROW_SELECT,
  })
}

export type UpdateIngredientResult =
  | { status: 'updated'; ingredient: HouseholdIngredient }
  | { status: 'not_found' }
  /** The new name is one `findExisting` resolves to another row. */
  | { status: 'name_taken' }
  /** Quantities are stored in the row's unit, so a used row keeps it. */
  | { status: 'unit_locked'; uses: IngredientUses }

/**
 * Saves a household row with the normalisation of `createHouseholdIngredient`.
 * A rename is checked as a new name would be, so it cannot create the
 * duplicate that create guards against. An unchanged name is not checked, so
 * the row never finds itself, and a global row added since does not block an
 * allergen fix.
 *
 * The meals that use the row get their `primaryProteinType` again, because the
 * planner's diet filter reads that column, not the ingredient.
 */
export async function updateHouseholdIngredient(
  householdId: string,
  locale: string,
  id: string,
  input: NewIngredientInput,
): Promise<UpdateIngredientResult> {
  const current = await prisma.ingredient.findFirst({
    where: { id, householdId },
    select: { name: true, defaultUnit: true, ...USES_COUNT },
  })
  if (!current) return { status: 'not_found' }

  const name = normaliseIngredientName(input.name)
  if (name !== current.name && (await findExisting(householdId, locale, name))) {
    return { status: 'name_taken' }
  }

  if (input.defaultUnit !== current.defaultUnit) {
    // A recipe deleted inside the restore window still locks the unit,
    // because a restore brings its quantities back in the old unit.
    const [deletedMealsInPlan, restorableMeals] = await Promise.all([
      prisma.mealComponent.count({ where: deletedMealComponents(id, true) }),
      prisma.mealComponent.count({
        where: { ingredientId: id, meal: { deletedAt: { gte: restoreWindowStart(new Date()) } } },
      }),
    ])
    const uses = toUses(current, deletedMealsInPlan)
    if (isInUse(uses) || restorableMeals > 0) return { status: 'unit_locked', uses }
  }

  const ingredient = await prisma.$transaction(async (tx) => {
    const saved = await tx.ingredient.update({
      where: { id },
      data: ingredientData(input),
      select: ROW_SELECT,
    })
    await rederiveMealProteinTypes(tx, { components: { some: { ingredientId: id } } })
    return saved
  })
  return { status: 'updated', ingredient }
}

/**
 * Re-resolves the protein of every meal that `where` finds. A chosen main
 * protein survives a protein-grams edit, and is cleared when the ingredient's
 * type moves away from it (HON-1386).
 */
async function rederiveMealProteinTypes(
  tx: Prisma.TransactionClient,
  where: Prisma.MealWhereInput,
) {
  const meals = await tx.meal.findMany({
    where,
    select: {
      id: true,
      primaryProteinType: true,
      proteinTypeOverride: true,
      components: {
        select: {
          quantityPerServing: true,
          isVague: true,
          ingredient: {
            select: { proteinType: true, protein: true, defaultUnit: true, gramsPerPiece: true },
          },
        },
      },
    },
  })
  for (const meal of meals) {
    const protein = resolveProteinType(meal.components, meal.proteinTypeOverride)
    if (
      protein.primaryProteinType !== meal.primaryProteinType ||
      protein.proteinTypeOverride !== meal.proteinTypeOverride
    ) {
      await tx.meal.update({ where: { id: meal.id }, data: protein })
    }
  }
}

export type DeleteIngredientResult =
  { status: 'deleted' } | { status: 'not_found' } | { status: 'in_use'; uses: IngredientUses }

/**
 * Deletes a household row nothing uses. The count and the delete share one
 * transaction, and several relations cascade, so a use is never deleted with
 * the row.
 *
 * A deleted recipe that no meal plan entry uses loses its component with the
 * row, so it cannot hold the row forever (HON-1325). Its protein is resolved
 * again, so a restore brings back no protein it lost. One a plan entry still
 * uses refuses the delete, because the entry's shopping list and nutrition
 * read its components.
 */
export async function deleteHouseholdIngredient(
  householdId: string,
  id: string,
): Promise<DeleteIngredientResult> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.ingredient.findFirst({
      where: { id, householdId },
      select: { id: true, ...USES_COUNT },
    })
    if (!row) return { status: 'not_found' }

    const deletedMealsInPlan = await tx.mealComponent.count({
      where: deletedMealComponents(id, true),
    })
    const uses = toUses(row, deletedMealsInPlan)
    if (isInUse(uses)) return { status: 'in_use', uses }

    const orphaned = deletedMealComponents(id, false)
    const mealIds = (
      await tx.mealComponent.findMany({ where: orphaned, select: { mealId: true } })
    ).map((component) => component.mealId)
    await tx.mealComponent.deleteMany({ where: orphaned })
    await rederiveMealProteinTypes(tx, { id: { in: mealIds } })
    await tx.ingredient.delete({ where: { id } })
    return { status: 'deleted' }
  })
}
