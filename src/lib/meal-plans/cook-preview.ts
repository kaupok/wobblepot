import 'server-only'

import { ingredientTranslationsInclude, translateIngredient } from '@/lib/i18n/content'
import { type DisplayUnit, displayUnit } from '@/lib/i18n/format-shopping-quantity'
import { isStarterStaple } from '@/lib/meal-planning/default-staples'
import {
  applyEntryChanges,
  ENTRY_CHANGES_FOR_DEDUCTION,
} from '@/lib/meal-planning/entry-components'
import { cookServingsSelect, getCookServings, sumPortions } from '@/lib/meal-planning/servings'
import {
  COOK_OUTCOME_INGREDIENT_SELECT,
  type CookOutcome,
  defaultCookOutcome,
} from '@/lib/pantry/cook-outcome'
import { prisma } from '@/lib/prisma'

/** One pantry row a cooked recipe meal would charge, as the household reads it. */
export interface PantryCheckRow {
  ingredientId: string
  /** In the household's locale. */
  name: string
  /** `quantityPerServing` × cook servings, in the ingredient's `defaultUnit`. */
  used: number
  unit: DisplayUnit
  pantryQuantity: number | null
  default: CookOutcome
  /** A staple: never subtracted, so it changes only when the household says so (HON-1588). */
  isStaple: boolean
  /** Running low already (HON-1586). */
  low: boolean
}

/**
 * The pantry rows `updateEntry` would charge if this entry were completed
 * now with `deductPantry` (HON-1565), without writing anything: the meal's
 * components with the entry's changes merged, scaled by the cook servings,
 * one row per pantry item, in component order. A staple is listed with
 * default `someLeft`, except a starter staple (salt, black pepper, water) and
 * a vague component ("to taste"), which are left out (HON-1588). Empty when the
 * completion would charge nothing: a fridge meal with no sides, an entry
 * already completed, or one charged before a revert (`pantryDeductedAt`,
 * HON-651).
 *
 * A main with sides previews the slot, as its completion charges it
 * (HON-1610): one row per ingredient, `used` summed across the main and each
 * side not completed or charged yet.
 */
export async function previewCookDeduction(
  householdId: string,
  planId: string,
  entryId: string,
  locale: string,
): Promise<PantryCheckRow[]> {
  const ingredientSelect = {
    ...COOK_OUTCOME_INGREDIENT_SELECT,
    name: true,
    measuredByVolume: true,
    ...ingredientTranslationsInclude(locale),
  }
  const dishSelect = {
    kind: true,
    ...cookServingsSelect,
    pantryDeductedAt: true,
    meal: {
      select: {
        components: {
          select: {
            ingredientId: true,
            quantityPerServing: true,
            isVague: true,
            ingredient: { select: ingredientSelect },
          },
        },
      },
    },
    changes: {
      ...ENTRY_CHANGES_FOR_DEDUCTION,
      select: {
        ...ENTRY_CHANGES_FOR_DEDUCTION.select,
        replacementIngredient: { select: ingredientSelect },
      },
    },
  } as const
  const entry = await prisma.mealPlanEntry.findFirst({
    where: { id: entryId, planId, plan: { householdId } },
    select: {
      ...dishSelect,
      sides: { orderBy: { id: 'asc' }, select: dishSelect },
      plan: {
        select: {
          household: {
            select: {
              members: { select: { preferences: { select: { portionMultiplier: true } } } },
            },
          },
        },
      },
    },
  })
  if (!entry || entry.status === 'completed') return []

  const householdServings = sumPortions(entry.plan.household.members)
  // Each ingredient once, in the order the dishes list it, with what every
  // dish uses of it summed.
  // A fridge main has no recipe of its own; a side the household skipped was
  // not made.
  const dishes = [
    ...(entry.kind === 'meal' ? [entry] : []),
    ...entry.sides.filter((side) => side.status === 'planned'),
  ]
    .filter((dish) => dish.pantryDeductedAt === null)
    .map((dish) => ({
      servings: getCookServings(dish, householdServings),
      components: applyEntryChanges(dish.meal?.components ?? [], dish.changes),
    }))
  const usedById = new Map<string, number>()
  const components: (typeof dishes)[number]['components'] = []
  for (const { servings, components: dishComponents } of dishes) {
    for (const component of dishComponents) {
      const used = usedById.get(component.ingredientId)
      if (used === undefined) components.push(component)
      usedById.set(component.ingredientId, (used ?? 0) + component.quantityPerServing * servings)
    }
  }

  if (components.length === 0) return []

  const pantryRows = await prisma.pantryItem.findMany({
    where: {
      householdId,
      ingredientId: { in: components.map((c) => c.ingredientId) },
    },
    select: { ingredientId: true, quantity: true, isStaple: true, lowAt: true },
  })
  const pantryRow = new Map(pantryRows.map((row) => [row.ingredientId, row]))

  // One row per ingredient: a meal lists an ingredient once (`MealComponent`
  // is unique on it), `applyEntryChanges` drops a change that would list it
  // twice, and the loop above merges the dishes.
  const rows: PantryCheckRow[] = []
  for (const { ingredientId, ingredient, isVague } of components) {
    const row = pantryRow.get(ingredientId)
    if (!row) continue
    if (row.isStaple && (isVague || isStarterStaple(ingredient.name))) continue
    const used = usedById.get(ingredientId)!
    rows.push({
      ingredientId,
      name: translateIngredient(ingredient, locale).name,
      used,
      unit: displayUnit(ingredient),
      pantryQuantity: row.quantity,
      // A staple is never subtracted: it stays unless the household says otherwise.
      default: row.isStaple
        ? 'someLeft'
        : defaultCookOutcome({
            pantryQuantity: row.quantity,
            isStaple: false,
            category: ingredient.category,
            subcategory: ingredient.subcategory,
            defaultUnit: ingredient.defaultUnit,
            amountUsed: used,
          })!,
      isStaple: row.isStaple,
      low: row.lowAt !== null,
    })
  }
  return rows
}
