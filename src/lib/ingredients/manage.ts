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

/**
 * The row's components on recipes deleted inside the restore window that no
 * plan entry uses (HON-1449). A restore brings each back, so the row must stay.
 * A recipe a plan entry uses is counted by `deletedMealComponents` instead.
 */
function restorableMealComponents(id: string, now: Date): Prisma.MealComponentWhereInput {
  return {
    ingredientId: id,
    meal: { deletedAt: { gte: restoreWindowStart(now) }, planEntries: { none: {} } },
  }
}

function toUses(
  { _count: c }: UsesCount,
  deletedMealsInPlan: number,
  deletedMealsRestorable: number,
): IngredientUses {
  return {
    meals: c.components,
    deletedMealsInPlan,
    deletedMealsRestorable,
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
    const [deletedMealsInPlan, deletedMealsRestorable] = await Promise.all([
      prisma.mealComponent.count({ where: deletedMealComponents(id, true) }),
      prisma.mealComponent.count({ where: restorableMealComponents(id, new Date()) }),
    ])
    const uses = toUses(current, deletedMealsInPlan, deletedMealsRestorable)
    if (isInUse(uses)) return { status: 'unit_locked', uses }
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
 * A deleted recipe past the restore window that no meal plan entry uses loses
 * its component with the row, so it cannot hold the row forever (HON-1325).
 * Its protein is resolved again. One inside the window refuses the delete,
 * because a restore would bring it back without the row (HON-1449). One a plan
 * entry uses, past or planned, refuses it too, because the entry's shopping
 * list and nutrition read its components.
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
    const deletedMealsRestorable = await tx.mealComponent.count({
      where: restorableMealComponents(id, new Date()),
    })
    const uses = toUses(row, deletedMealsInPlan, deletedMealsRestorable)
    if (isInUse(uses)) return { status: 'in_use', uses }

    // Only recipes past the restore window are left here.
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
