import 'server-only'
import { z } from 'zod'
import { MAX_ADJUST_CHANGES, type AdjustRecipeChange } from '@/lib/ai/adjust-recipe'
import { fuzzySearchIngredient } from '@/lib/ai/fuzzy-ingredient-match'
import { translateIngredientNames } from '@/lib/ai/translate-match-results'
import { translateIngredient } from '@/lib/i18n/content'
import { displayUnit } from '@/lib/i18n/format-shopping-quantity'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { resolveProposals, type AdjustContext } from '@/lib/meal-planning/adjust-entry'
import { fittingComponents } from '@/lib/meal-planning/adjust-proposal'
import { MAX_QUANTITY_PER_SERVING } from '@/lib/meal-planning/components-schema'
import { applyEntryChanges, staleChangeIds } from '@/lib/meal-planning/entry-components'
import { getCookServings, sumPortions } from '@/lib/meal-planning/servings'
import { loadEntryForAi } from '@/lib/meal-plans/entry-context'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import { amountWarning } from './amount-warning'
import {
  acceptedOf,
  ingredientsOutput,
  loadChangeableEntry,
  mealIngredients,
  unitOutput,
  writeChanges,
} from './meal-changes'
import { MEASURED_UNITS, type MeasuredUnit } from './measured-units'
import { slotInput } from './plan-slot'

const NAME_MAX = 100

const AMOUNT_NOTE =
  'This tool does not change an amount, so an ingredient in alreadyInMeal keeps the amount get_meal shows. To give an added ingredient a new amount, restore it and add it again in one call.'

const ingredientName = z.string().trim().min(1).max(NAME_MAX)
const mealIngredientName = ingredientName.describe(
  'An ingredient of this meal, with the name copied from get_meal.',
)
const amount = {
  quantity: z
    .number()
    .positive()
    .describe("The amount for the meal's servings, as get_meal shows amounts, in unit."),
  unit: z
    .enum(MEASURED_UNITS)
    .describe('g, ml or piece. Convert other units first: 2 tablespoons of oil is 30 ml.'),
}

type Action = 'replace' | 'leave_out' | 'add' | 'restore'

export const changeMealIngredients = defineTool({
  name: 'change_meal_ingredients',
  title: 'Replace, add or leave out a planned meal’s ingredients',
  description:
    'Changes the ingredients of the meal planned for one day and meal type, when the user names them: "rice instead of potatoes and carrots", "add 400 g broccoli", "leave out the onion", "bring the carrots back". For an instruction in plain words ("less spicy", "make it for a toddler"), use adjust_meal. Copy ingredient names from get_meal, and give amounts for the meal\'s servings, as get_meal shows them. It does not change an amount: an ingredient that goes back to the recipe takes the recipe\'s amount, whatever amount you send, and applied shows that amount. Only that one entry changes, never the recipe: the planner shows the meal with a Changed badge, the shopping list follows, and the steps are written again the next time the meal is opened. Nothing is written unless every change applies. On not_changed, the lists say why: unmatched (Wobblepot has no ingredient by that name; alternatives are the closest it has), notInMeal, ambiguous (the name fits several of the meal\'s ingredients), alreadyInMeal (with a note: the tool does not change an amount), notChanged (no change to restore). Ask the user about each listed name and call again with all the changes. On check_quantity, confirm the amount in check with the user and call again with it in check.unit. Only a planned meal can change: a cooked or skipped one is refused. It does not use the household\'s AI allowance.',
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false },
  inputSchema: z.object({
    ...slotInput,
    changes: z
      .array(
        z.discriminatedUnion('action', [
          z.object({
            action: z.literal('replace'),
            ingredients: z
              .array(mealIngredientName)
              .min(1)
              .max(5)
              .describe(
                'The ingredients to replace. The first is replaced and the others are left out: "rice instead of potatoes and carrots" is ["potatoes", "carrots"].',
              ),
            with: ingredientName.describe(
              'The ingredient to use instead, as a shop sells it, with no amount or preparation.',
            ),
            ...amount,
          }),
          z.object({ action: z.literal('leave_out'), ingredient: mealIngredientName }),
          z.object({
            action: z.literal('add'),
            ingredient: ingredientName.describe(
              'The ingredient to add, as a shop sells it, with no amount or preparation.',
            ),
            ...amount,
          }),
          z.object({
            action: z.literal('restore'),
            ingredient: ingredientName.describe(
              'A recipe ingredient that was replaced or left out, or an ingredient that was added. Its change is undone, so the meal follows the recipe for it again.',
            ),
          }),
        ]),
      )
      .min(1)
      .max(MAX_ADJUST_CHANGES)
      .describe(
        `The changes, all applied together or none. At most ${MAX_ADJUST_CHANGES} ingredients in all: a replace counts each ingredient it names.`,
      ),
  }),
  outputSchema: z.object({
    outcome: z
      .enum(['changed', 'not_changed', 'check_quantity'])
      .describe(
        'changed: every change in applied was made. not_changed: a change could not apply, so nothing was written. check_quantity: an amount needs a check, so nothing was written.',
      ),
    date: z.iso.date(),
    mealType: z.enum(['breakfast', 'lunch', 'dinner']),
    meal: z.object({ id: z.string(), name: z.string() }),
    applied: z
      .array(
        z.object({
          action: z.enum(['replace', 'leave_out', 'add', 'restore']),
          original: z
            .string()
            .nullable()
            .describe('The ingredient changed or restored; null for an add.'),
          replacement: z
            .string()
            .nullable()
            .describe('The ingredient brought in; null for a leave-out or a restore.'),
          quantity: z
            .number()
            .nullable()
            .describe("The amount saved, at the meal's servings; null for a vague recipe amount."),
          unit: unitOutput.nullable(),
          backToRecipe: z
            .boolean()
            .describe(
              "True when the replacement is the recipe's own ingredient: it went back to the recipe's amount, not the amount sent.",
            ),
        }),
      )
      .describe('Empty unless outcome is changed.'),
    unmatched: z
      .array(z.object({ name: z.string(), alternatives: z.array(z.string()) }))
      .describe('Names Wobblepot has no sure ingredient for, with at most 3 closest ones.'),
    notInMeal: z.array(z.string()).describe('Names this meal has no ingredient for.'),
    ambiguous: z.array(z.string()).describe('Names that fit several of this meal’s ingredients.'),
    alreadyInMeal: z
      .array(z.string())
      .describe('Ingredients to bring in that the meal or another change already has.'),
    note: z
      .string()
      .nullable()
      .describe('Why alreadyInMeal is not empty, and what to do instead; null otherwise.'),
    notChanged: z
      .array(z.string())
      .describe('Names to restore that no change of this meal fits, or that fit several.'),
    check: z
      .object({
        name: z.string(),
        quantity: z.number(),
        unit: unitOutput,
        warning: z.string(),
      })
      .nullable()
      .describe(
        "For check_quantity: the matched ingredient, the amount converted at the meal's servings, and why.",
      ),
    ingredients: ingredientsOutput,
  }),
  run: async (household, { date, mealType, changes }) => {
    const locale = resolveHouseholdLocale(household)
    const { slot, context } = await loadChangeableEntry(household, date, mealType, locale)
    const servings = getCookServings(context, sumPortions(household.members))

    // Restore is the app's Undo: the live change is left out of the new set.
    const live = liveChanges(context, locale)
    const dropped = new Map<string, string>()
    const notChanged: string[] = []
    for (const item of changes) {
      if (item.action !== 'restore') continue
      const fitting = fittingComponents(live, item.ingredient)
      if (fitting.length === 1) dropped.set(fitting[0]!.id, fitting[0]!.name)
      else notChanged.push(item.ingredient)
    }

    // One row per change the resolver takes, with what the user asked for
    // beside it. Amounts are per serving; 1 ml counts as 1 g, as the matcher
    // converts it.
    const rows: { row: AdjustRecipeChange; action: Action; asked: Asked | null }[] = []
    const add = (action: Action, row: Omit<AdjustRecipeChange, 'reason'>, asked: Asked | null) =>
      rows.push({ row: { ...row, reason: '' }, action, asked })
    for (const item of changes) {
      if (item.action === 'replace') {
        const [first, ...rest] = item.ingredients
        add('replace', replaceRow(first!, item.with, item, servings), item)
        for (const original of rest) add('leave_out', removeRow(original), null)
      } else if (item.action === 'leave_out') {
        add('leave_out', removeRow(item.ingredient), null)
      } else if (item.action === 'add') {
        add('add', { ...replaceRow(null, item.ingredient, item, servings), op: 'add' }, item)
      }
    }
    // The resolver takes at most MAX_ADJUST_CHANGES rows and drops the rest,
    // and a replace of N ingredients is N rows.
    if (rows.length > MAX_ADJUST_CHANGES) {
      throw new ToolInputError(
        `These changes touch ${rows.length} ingredients; at most ${MAX_ADJUST_CHANGES} can change in one call. Split them into two calls. Nothing was changed.`,
      )
    }

    // The rows apply to the meal after the restores, so a call can restore an
    // added ingredient and add it again at a new amount. The write still
    // reads the stored changes from `context`.
    const kept = context.changes.filter((change) => !dropped.has(change.id))
    const restored = {
      ...context,
      changes: kept,
      components: applyEntryChanges(context.meal.components, kept),
    }
    const resolved = await resolveProposals(
      rows.map((r) => r.row),
      restored,
      household.id,
      locale,
    )

    const unmatched = await Promise.all(
      resolved.unmatched.map(async (name) => ({
        name,
        alternatives: (
          await translateIngredientNames(
            (await fuzzySearchIngredient(name, { householdId: household.id, locale })).slice(0, 3),
            locale,
          )
        ).map((c) => c.name),
      })),
    )
    const lists = {
      unmatched,
      notInMeal: resolved.notInMeal,
      ambiguous: resolved.ambiguous,
      alreadyInMeal: resolved.alreadyInMeal,
      notChanged,
    }
    const unchanged = (outcome: 'not_changed' | 'check_quantity', check: Check | null = null) => ({
      outcome,
      date,
      mealType,
      meal: { id: slot.mealId, name: slot.mealName ?? '' },
      applied: [],
      ...lists,
      note: lists.alreadyInMeal.length > 0 ? AMOUNT_NOTE : null,
      check,
      ingredients: mealIngredients(context, household, locale),
    })
    if (Object.values(lists).some((list) => list.length > 0)) return unchanged('not_changed')
    // Every name resolved, yet a row went: two changes touch one ingredient.
    // A row that supersedes a restored change touches it too.
    if (
      resolved.changes.length !== rows.length ||
      resolved.changes.some((c) => c.replacesChangeId !== null && dropped.has(c.replacesChangeId))
    ) {
      throw new ToolInputError(
        'Two of the changes name the same ingredient of this meal. Name each ingredient once and call again. Nothing was changed.',
      )
    }

    // Nothing was dropped, so the proposals line up with the rows.
    for (const [i, proposal] of resolved.changes.entries()) {
      const asked = rows[i]!.asked
      const match = resolved.matches.get(proposal)
      if (!asked || !match || !proposal.replacement?.matched) continue
      const { ingredient } = proposal.replacement
      // Back to the recipe's own ingredient: the amount sent is not saved, so
      // there is no amount to check.
      if (ingredient.id === proposal.originalIngredientId) continue
      const shown = displayUnit(ingredient)
      const converted = Math.round(match.convertedQuantity * servings * 100) / 100
      const warning = amountWarning(
        match,
        ingredient.name,
        asked.quantity,
        asked.unit,
        converted,
        shown,
      )
      if (warning) {
        return unchanged('check_quantity', {
          name: ingredient.name,
          quantity: converted,
          unit: shown,
          warning,
        })
      }
    }

    await writeChanges(household.id, context, resolved.changes.map(acceptedOf), {
      note: null,
      tool: 'change_meal_ingredients',
      dropped: new Set(dropped.keys()),
    })
    const entry = await loadEntryForAi(household.id, slot.planId, slot.id, locale)

    return {
      outcome: 'changed' as const,
      date,
      mealType,
      meal: { id: slot.mealId, name: slot.mealName ?? '' },
      applied: [
        ...resolved.changes.map((proposal, i) => {
          const replacement = proposal.replacement?.matched ? proposal.replacement : null
          // Back to the recipe's own ingredient: no row is written, so the
          // meal has the recipe's amount, not the one sent (`rowOf`).
          const recipe =
            replacement && replacement.ingredient.id === proposal.originalIngredientId
              ? context.meal.components.find((c) => c.ingredientId === replacement.ingredient.id)
              : undefined
          const quantity = recipe
            ? recipe.isVague && recipe.originalPhrase
              ? null
              : recipe.quantityPerServing * servings
            : replacement
              ? replacement.quantityPerServing * servings
              : null
          return {
            action: rows[i]!.action,
            original: proposal.original?.name ?? null,
            replacement: replacement?.ingredient.name ?? null,
            quantity,
            unit: replacement ? displayUnit(recipe?.ingredient ?? replacement.ingredient) : null,
            backToRecipe: !!recipe,
          }
        }),
        ...[...dropped.values()].map((name) => ({
          action: 'restore' as const,
          original: name,
          replacement: null,
          quantity: null,
          unit: null,
          backToRecipe: false,
        })),
      ],
      ...lists,
      note: null,
      check: null,
      ingredients: mealIngredients(entry, household, locale),
    }
  },
})

interface Asked {
  quantity: number
  unit: MeasuredUnit
}

interface Check {
  name: string
  quantity: number
  unit: MeasuredUnit
  warning: string
}

function replaceRow(original: string | null, replacement: string, asked: Asked, servings: number) {
  const quantityPerServing = asked.quantity / servings
  // The resolver drops a larger amount silently, and nothing may drop here.
  if (quantityPerServing > MAX_QUANTITY_PER_SERVING) {
    throw new ToolInputError(
      `${asked.quantity} ${asked.unit} of ${replacement} is more than ${MAX_QUANTITY_PER_SERVING} ${asked.unit} a serving. Check the amount and call again. Nothing was changed.`,
    )
  }
  return {
    op: 'replace' as const,
    original,
    replacement,
    quantityPerServing,
    unit: asked.unit === 'piece' ? ('piece' as const) : ('g' as const),
  }
}

function removeRow(original: string) {
  return {
    op: 'remove' as const,
    original,
    replacement: null,
    quantityPerServing: null,
    unit: null,
  }
}

/**
 * The entry's live changes, each named by the recipe ingredient it changes,
 * or by the ingredient it adds.
 */
function liveChanges(context: AdjustContext, locale: string) {
  const stale = staleChangeIds(context.meal.components, context.changes)
  const recipe = new Map(context.meal.components.map((c) => [c.ingredientId, c.ingredient]))
  return context.changes.flatMap((change) => {
    if (stale.has(change.id)) return []
    const ingredient = change.originalIngredientId
      ? recipe.get(change.originalIngredientId)
      : change.replacementIngredient
    return ingredient ? [{ id: change.id, name: translateIngredient(ingredient, locale).name }] : []
  })
}
