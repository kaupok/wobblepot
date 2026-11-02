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
 * completion would charge nothing: a fridge meal, an entry already completed,
 * or one charged before a revert (`pantryDeductedAt`, HON-651).
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
  const entry = await prisma.mealPlanEntry.findFirst({
    where: { id: entryId, planId, plan: { householdId } },
    select: {
      kind: true,
      ...cookServingsSelect,
      pantryDeductedAt: true,
      plan: {
        select: {
          household: {
            select: {
              members: { select: { preferences: { select: { portionMultiplier: true } } } },
            },
          },
        },
      },
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
    },
  })
  if (
    !entry ||
    entry.kind !== 'meal' ||
    entry.status === 'completed' ||
    entry.pantryDeductedAt !== null
  ) {
    return []
  }

  const components = applyEntryChanges(entry.meal?.components ?? [], entry.changes)
  const servings = getCookServings(entry, sumPortions(entry.plan.household.members))

  if (components.length === 0) return []

  const pantryRows = await prisma.pantryItem.findMany({
    where: {
      householdId,
      ingredientId: { in: components.map((c) => c.ingredientId) },
    },
    select: { ingredientId: true, quantity: true, isStaple: true, lowAt: true },
  })
  const pantryRow = new Map(pantryRows.map((row) => [row.ingredientId, row]))

  // One row per component: a meal lists an ingredient once (`MealComponent`
  // is unique on it), and `applyEntryChanges` drops a change that would list
  // it twice.
  const rows: PantryCheckRow[] = []
  for (const { ingredientId, ingredient, quantityPerServing, isVague } of components) {
    const row = pantryRow.get(ingredientId)
    if (!row) continue
    if (row.isStaple && (isVague || isStarterStaple(ingredient.name))) continue
    const used = quantityPerServing * servings
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
