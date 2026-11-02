import 'server-only'

import { z } from 'zod'

import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import { previewCookDeduction } from '@/lib/meal-plans/cook-preview'
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
 *
 * A recipe meal that would charge a "have some" pantry row is not written on
 * the first cooked call: it answers `needsPantryCheck`, and the assistant asks
 * the household which rows ran out (HON-1565). The deduction is a one-time
 * write (`pantryDeductedAt`, HON-651), so a wrong guess could not be undone by
 * a second call. A staple the meal used asks too, because only the household
 * knows when one is used up or running low (HON-1588).
 */
export const setMealStatus = defineTool({
  name: 'set_meal_status',
  title: 'Mark a meal cooked or skipped',
  description:
    'Marks a planned meal cooked, skipped, or planned again, by day and meal type, as the Cooked and Skipped buttons in the app do. Cooking a recipe meal takes its ingredients out of the pantry, once per meal. When the pantry holds some of the meal’s ingredients with no amount, the first cooked call writes nothing and returns outcome needsPantryCheck with pantryCheck: each item, how much the meal used, and a default of usedUp or someLeft. Ask the household one short question ("Pumpkin, carrots and sweet potato look used up; the jars and spices have some left. Right?"), then call again with usedUpIngredientIds: the ids now used up; those go to ran out, the rest stay. Pass [] when everything has some left. Pass defaultUsedUpIngredientIds unchanged when you cannot ask. For a fridge meal, pass usedUpIngredientIds the same way: the ingredientIds (from get_pantry) of its pantry items the household used up; those go to zero. Setting a cooked meal back to planned does not put its ingredients back in the pantry. After cooked, you can ask the user how it was and call rate_meal. A pantryCheck row with isStaple is a staple this meal used, with no amount tracked: it stays unless the household says it is used up or running low. Put the ids of items that are nearly gone in lowIngredientIds: they go on the shopping list now, with no amount, and stay available to planned meals.',
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
        'Cooked only: the ingredientIds of the meal’s pantry items that are used up. [] means none are. Ids that are not among the meal’s items are ignored.',
      ),
    lowIngredientIds: z
      .array(z.string())
      .optional()
      .describe(
        'Cooked recipe meal only: the ingredientIds of the meal’s pantry items that are running low. An id also in usedUpIngredientIds is used up.',
      ),
  }),
  outputSchema: z.object({
    outcome: z
      .enum(['updated', 'unchanged', 'needsPantryCheck'])
      .describe(
        'unchanged: the meal already had this status, so nothing was written. needsPantryCheck: nothing was written; ask the household and call again with usedUpIngredientIds.',
      ),
    date: z.iso.date(),
    mealType: z.enum(['breakfast', 'lunch', 'dinner']),
    status: statusSchema,
    meal: z
      .object({ id: z.string(), name: z.string() })
      .nullable()
      .describe('The recipe meal. Null for a fridge meal.'),
    pantryDeducted: z.boolean().describe('True when this call took items out of the pantry.'),
    pantryCheck: z
      .array(
        z.object({
          ingredientId: z.string(),
          name: z.string(),
          used: z.number().describe('How much this meal uses, in unit.'),
          unit: z.enum(['g', 'ml', 'piece']),
          pantryQuantity: z
            .number()
            .nullable()
            .describe('null: the pantry has some, amount unknown.'),
          default: z
            .enum(['subtract', 'usedUp', 'someLeft'])
            .describe(
              'subtract: a known amount loses what the meal used. usedUp or someLeft: the guess for an item with no amount, or for a staple.',
            ),
          isStaple: z
            .boolean()
            .describe('A staple: never subtracted; it stays unless used up or running low.'),
          low: z.boolean().describe('Already running low.'),
        }),
      )
      .optional()
      .describe('needsPantryCheck only: the pantry items this meal takes from, in recipe order.'),
    defaultUsedUpIngredientIds: z
      .array(z.string())
      .optional()
      .describe('needsPantryCheck only: the ids whose default is usedUp.'),
  }),
  run: async (household, { date, mealType, status, usedUpIngredientIds, lowIngredientIds }) => {
    const slot = await findPlanSlot(household, date, mealType)
    const isFridge = slot.kind === 'fridge'
    if (!isFridge && !slot.mealId) {
      throw new ToolInputError(
        `No meal is planned for ${mealType} on ${date}, so there is nothing to mark. Nothing was changed.`,
      )
    }
    if (usedUpIngredientIds?.length && status !== 'cooked') {
      throw new ToolInputError(
        'usedUpIngredientIds is only for marking a meal cooked. Nothing was changed.',
      )
    }
    if (lowIngredientIds?.length && (status !== 'cooked' || isFridge)) {
      throw new ToolInputError(
        'lowIngredientIds is only for marking a recipe meal cooked. Nothing was changed.',
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

    // `[]` is an answer too: everything has some left. So is a low list.
    if (
      status === 'cooked' &&
      !isFridge &&
      usedUpIngredientIds === undefined &&
      lowIngredientIds === undefined
    ) {
      const pantryCheck = await previewCookDeduction(
        household.id,
        slot.planId,
        slot.id,
        resolveHouseholdLocale(household),
      )
      if (pantryCheck.some((row) => row.pantryQuantity === null || row.isStaple)) {
        return {
          ...result,
          outcome: 'needsPantryCheck' as const,
          pantryDeducted: false,
          pantryCheck,
          defaultUsedUpIngredientIds: pantryCheck
            .filter((row) => row.default === 'usedUp')
            .map((row) => row.ingredientId),
        }
      }
    }

    // The bodies the app sends: Confirm in the deduction dialog always
    // deducts (`completeWithDeduction`), with the household's used-up ids
    // when it answered the check; a fridge meal names what it used up
    // (`completeFridgeMeal`); and Skipped or a revert never deducts.
    const patch: EntryPatch =
      status !== 'cooked'
        ? { status: entryStatus, deductPantry: false }
        : isFridge
          ? { status: entryStatus, usedUpIngredientIds }
          : {
              status: entryStatus,
              deductPantry: true,
              ...(usedUpIngredientIds && { usedUpIngredientIds }),
              ...(lowIngredientIds && { lowIngredientIds }),
            }

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
