import 'server-only'

import { z } from 'zod'

import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import {
  type EntryPatch,
  EntryUpdateError,
  type EntryUpdateRefusal,
  updateEntry,
} from '@/lib/meal-plans/entries'

import { findPlanSlot, slotInput } from './plan-slot'

const statusSchema = z.enum(['cooked', 'skipped', 'planned'])

/** The tool says "cooked", as the app's badge and `get_meal_plan`'s `isCooked` do. */
const ENTRY_STATUS = {
  cooked: 'completed',
  skipped: 'skipped',
  planned: 'planned',
} as const satisfies Record<z.output<typeof statusSchema>, EntryPatch['status']>

const STALE = 'The meal plan changed while this ran. Try again.'

// A status patch can meet only `entryNotFound` (the entry went away after
// `findPlanSlot`) and `staleMeal` (the meal, servings or changes moved during
// the deduction). The rest answer a swap, a servings change or a note, so
// they too can only mean the entry moved underneath this call.
const REFUSALS: Record<EntryUpdateRefusal, string> = {
  entryNotFound: STALE,
  mealNotFound: STALE,
  noFields: STALE,
  completedSwap: STALE,
  completedServings: STALE,
  staleMeal: STALE,
  noNote: STALE,
}

/**
 * Marks a planned meal cooked, skipped or planned again (HON-1330): what
 * Cooked and Skipped on a planner card do (`use-entry-status.ts`), so an
 * assistant can act on "we made the curry" and then `rate_meal` it.
 */
export const setMealStatus = defineTool({
  name: 'set_meal_status',
  title: 'Mark a meal cooked or skipped',
  description:
    'Marks a planned meal cooked, skipped, or planned again, by day and meal type, as the Cooked and Skipped buttons in the app do. Cooking a recipe meal takes its ingredients out of the pantry, once per meal. For a fridge meal, pass usedUpIngredientIds: the ingredientIds (from get_pantry) of its pantry items the household used up; those go to zero. Setting a cooked meal back to planned does not put its ingredients back in the pantry. After cooked, you can ask the user how it was and call rate_meal.',
  // Idempotent: the same call twice leaves the same status, and the pantry is
  // charged at most once per entry (`pantryDeductedAt`, HON-651).
  annotations: WRITE_ANNOTATIONS,
  inputSchema: z.object({
    ...slotInput,
    status: statusSchema.describe(
      'cooked: the household made it. skipped: they did not. planned: undo either.',
    ),
    usedUpIngredientIds: z
      .array(z.string())
      .optional()
      .describe(
        'Fridge meal and cooked only: the ingredientIds of its pantry items that are used up. Ids that are not among the meal’s items are ignored.',
      ),
  }),
  outputSchema: z.object({
    outcome: z
      .enum(['updated', 'unchanged'])
      .describe('unchanged: the meal already had this status, so nothing was written.'),
    date: z.iso.date(),
    mealType: z.enum(['breakfast', 'lunch', 'dinner']),
    status: statusSchema,
    meal: z
      .object({ id: z.string(), name: z.string() })
      .nullable()
      .describe('The recipe meal. Null for a fridge meal.'),
    pantryDeducted: z.boolean().describe('True when this call took items out of the pantry.'),
  }),
  run: async (household, { date, mealType, status, usedUpIngredientIds }) => {
    const slot = await findPlanSlot(household, date, mealType)
    const isFridge = slot.kind === 'fridge'
    if (!isFridge && !slot.mealId) {
      throw new ToolInputError(
        `No meal is planned for ${mealType} on ${date}, so there is nothing to mark. Nothing was changed.`,
      )
    }
    if (usedUpIngredientIds?.length && !(isFridge && status === 'cooked')) {
      throw new ToolInputError(
        'usedUpIngredientIds is only for marking a fridge meal cooked. A recipe meal takes its own ingredients out of the pantry. Nothing was changed.',
      )
    }

    const result = {
      date,
      mealType,
      status,
      meal: isFridge || !slot.mealId ? null : { id: slot.mealId, name: slot.mealName! },
    }
    const entryStatus = ENTRY_STATUS[status]
    if (slot.status === entryStatus) {
      return { ...result, outcome: 'unchanged' as const, pantryDeducted: false }
    }

    // The bodies the app sends: Confirm in the deduction dialog always
    // deducts (`completeWithDeduction`), a fridge meal names what it used up
    // (`completeFridgeMeal`), and Skipped or a revert never deducts.
    const patch: EntryPatch =
      status !== 'cooked'
        ? { status: entryStatus, deductPantry: false }
        : isFridge
          ? { status: entryStatus, usedUpIngredientIds }
          : { status: entryStatus, deductPantry: true }

    try {
      const updated = await updateEntry(household.id, slot.planId, slot.id, patch)
      return {
        ...result,
        outcome: 'updated' as const,
        pantryDeducted: updated.pantryDeducted ?? false,
      }
    } catch (error) {
      if (error instanceof EntryUpdateError) throw new ToolInputError(REFUSALS[error.reason])
      throw error
    }
  },
})
