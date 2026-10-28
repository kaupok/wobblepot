import 'server-only'
import { z } from 'zod'
import { translateIngredient } from '@/lib/i18n/content'
import { displayUnit } from '@/lib/i18n/format-shopping-quantity'
import {
  AdjustEntryError,
  loadAdjustContext,
  type AdjustContext,
} from '@/lib/meal-planning/adjust-entry'
import {
  buildChangeSet,
  type AcceptedProposal,
  type AdjustProposal,
  type MatchedReplacement,
} from '@/lib/meal-planning/adjust-proposal'
import { staleChangeIds } from '@/lib/meal-planning/entry-components'
import { getEffectiveServings, sumPortions } from '@/lib/meal-planning/servings'
import { EntryChangeError, replaceEntryChanges } from '@/lib/meal-plans/entry-changes'
import { ToolInputError, type McpHousehold } from '@/lib/mcp/context'
import { findPlanSlot, type SlotMealType } from './plan-slot'

/**
 * What `adjust_meal` and `change_meal_ingredients` (HON-1385) share: the
 * entry they may change, the write of its new change set, and the
 * ingredients they return.
 */

export const unitOutput = z.enum(['g', 'ml', 'piece'])

export const ingredientsOutput = z
  .array(
    z.object({
      name: z.string(),
      quantity: z.number().nullable(),
      unit: unitOutput,
      note: z.string().nullable(),
    }),
  )
  .describe("The meal's ingredients after this call, at the entry's servings.")

/** The planned entry of a slot, refused with a sentence when it has no meal or is not planned. */
export async function loadChangeableEntry(
  household: McpHousehold,
  date: string,
  mealType: SlotMealType,
  locale: string,
) {
  const slot = await findPlanSlot(household, date, mealType)
  if (!slot.mealId) {
    throw new ToolInputError(
      `The ${mealType} on ${date} has no meal, so there are no ingredients to change. Use swap_meal to plan one. Nothing was changed.`,
    )
  }
  if (slot.status !== 'planned') {
    throw new ToolInputError(notPlannedMessage(mealType, date, slot.status))
  }
  const context = await loadAdjustContext(household.id, slot.planId, slot.id, locale).catch(
    (error: unknown) => {
      if (error instanceof AdjustEntryError) {
        throw new ToolInputError(notPlannedMessage(mealType, date, 'changed'))
      }
      throw error
    },
  )
  return { slot: { ...slot, mealId: slot.mealId }, context }
}

function notPlannedMessage(mealType: string, date: string, status: string) {
  const what =
    status === 'completed'
      ? 'was already cooked'
      : status === 'skipped'
        ? 'was skipped'
        : 'changed while this ran'
  return `The ${mealType} on ${date} ${what}, so its ingredients cannot be changed. Use get_meal_plan to see the plan. Nothing was changed.`
}

/** An accepted proposal, which is a remove or has a matched replacement. */
export function acceptedOf(proposal: AdjustProposal): AcceptedProposal {
  const replacement = proposal.replacement as MatchedReplacement | null
  return {
    proposal,
    replacementIngredientId: replacement?.ingredient.id ?? null,
    quantityPerServing: replacement?.quantityPerServing ?? null,
  }
}

/**
 * The entry's new change set, built as the review dialog builds it, through
 * the app's whole-set write. `basedOn` is every change the proposals were
 * made against, so a change the household made meanwhile refuses the write.
 * A change in `dropped` is left out of the new set: the app's Undo.
 */
export async function writeChanges(
  householdId: string,
  context: AdjustContext,
  accepted: AcceptedProposal[],
  options: { note: string | null; tool: string; dropped?: ReadonlySet<string> },
) {
  const stale = staleChangeIds(context.meal.components, context.changes)
  const stored = context.changes
    .filter((change) => !options.dropped?.has(change.id))
    .map((change) => ({
      id: change.id,
      original: change.originalIngredientId ? { id: change.originalIngredientId } : null,
      replacement: change.replacementIngredientId ? { id: change.replacementIngredientId } : null,
      quantityPerServing: change.quantityPerServing,
      stale: stale.has(change.id),
    }))
  try {
    await replaceEntryChanges(householdId, context.planId, context.id, {
      changes: buildChangeSet(stored, accepted),
      basedOn: context.changes.map((change) => change.id),
      adjustmentNote: options.note,
      noteMode: 'append',
    })
  } catch (error) {
    if (error instanceof EntryChangeError && error.reason === 'changesMoved') {
      throw new ToolInputError(
        `The meal's ingredients changed while this ran. Call ${options.tool} again. Nothing was changed.`,
      )
    }
    // Cooked or skipped between the read and the write.
    if (error instanceof EntryChangeError && error.reason === 'notPlanned') {
      throw new ToolInputError(
        'The meal was cooked or skipped while this ran, so its ingredients cannot be changed. Nothing was changed.',
      )
    }
    throw error
  }
}

/** The entry's merged ingredients at its effective servings, as `get_meal` shows them. */
export function mealIngredients(
  entry: Pick<AdjustContext, 'components' | 'servingOverride'>,
  household: Pick<McpHousehold, 'members'>,
  locale: string,
): z.infer<typeof ingredientsOutput> {
  const servings = getEffectiveServings(entry, sumPortions(household.members))
  return entry.components.map((component) => {
    // A vague amount ("a pinch") is a phrase, not a number to scale, as in get_meal.
    const vague = component.isVague && !!component.originalPhrase
    return {
      name: translateIngredient(component.ingredient, locale).name,
      quantity: vague ? null : component.quantityPerServing * servings,
      unit: displayUnit(component.ingredient),
      note: vague ? component.originalPhrase : null,
    }
  })
}
