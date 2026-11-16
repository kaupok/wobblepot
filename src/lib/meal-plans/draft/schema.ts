import { z } from 'zod'

import { FRIDGE_ITEM_LABEL_MAX, FRIDGE_ITEMS_MAX, leftoverServingsSchema } from '../fridge-items'

/**
 * A draft week (HON-1652): the slots an assistant wants to change, in one
 * input that `check_plan` checks and `apply_plan` writes. A slot the draft
 * does not name stays as it is. The draft lives in the assistant's
 * conversation; nothing stores it.
 */

/** Most slots one draft names: two weeks of three meals. */
export const DRAFT_SLOTS_MAX = 42

const mealTypeSchema = z.enum(['breakfast', 'lunch', 'dinner'])

/** A day and meal type, the way `get_meal_plan` reports an entry. */
const slotKeySchema = {
  date: z.iso.date().describe('The day, YYYY-MM-DD, as get_meal_plan reports it.'),
  mealType: mealTypeSchema.describe('The meal of that day.'),
}

const leftoverServings = leftoverServingsSchema
  .optional()
  .describe(
    'How much of the source meal this meal takes, 0.5 to 20 in steps of 0.5. Required while the source is not cooked yet: it then cooks and buys for these servings too.',
  )

export const draftItemSchema = z.union([
  z.object({ ingredientId: z.string().min(1) }).strict(),
  z.object({ label: z.string().trim().min(1).max(FRIDGE_ITEM_LABEL_MAX) }).strict(),
  z.object({ sourceEntryId: z.string().min(1), servings: leftoverServings }).strict(),
  z
    .object({
      leftoverOf: z
        .object(slotKeySchema)
        .strict()
        .describe('The slot whose main meal gives the leftovers, as it is after this draft.'),
      servings: leftoverServings,
    })
    .strict(),
])

/** Each source once on a fridge meal, as `fridgeItemsSchema` holds (HON-1441). */
const draftItemsSchema = z
  .array(draftItemSchema)
  .min(1)
  .max(FRIDGE_ITEMS_MAX)
  .superRefine((items, ctx) => {
    const seen = new Set<string>()
    items.forEach((item, index) => {
      const key =
        'sourceEntryId' in item
          ? item.sourceEntryId
          : 'leftoverOf' in item
            ? slotKey(item.leftoverOf)
            : null
      if (key === null) return
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Each meal can give leftovers once to a fridge meal. Name each source once.',
          path: [index],
        })
      }
      seen.add(key)
    })
  })

export const draftSlotSchema = z.union([
  z
    .object({
      ...slotKeySchema,
      mealId: z.string().min(1).describe('A recipe meal, from list_meals.'),
      servings: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("The meal's own servings, 1 to 20. Omit it for the household default."),
    })
    .strict(),
  z
    .object({
      ...slotKeySchema,
      items: draftItemsSchema.describe(
        'A fridge meal. Each item is { ingredientId } from get_pantry, { label } as free text, or leftovers: { leftoverOf: { date, mealType } } or { sourceEntryId } from get_meal_plan, with servings.',
      ),
    })
    .strict(),
  z
    .object({
      ...slotKeySchema,
      clear: z.literal(true).describe('The slot becomes empty.'),
    })
    .strict(),
])

export const draftSlotsSchema = z.array(draftSlotSchema).min(1).max(DRAFT_SLOTS_MAX)

export type DraftSlot = z.output<typeof draftSlotSchema>
export type DraftItem = z.output<typeof draftItemSchema>
export type DraftMealType = z.output<typeof mealTypeSchema>

/** One key per slot, so a draft slot, a stored entry and a `leftoverOf` meet. */
export function slotKey(slot: { date: string; mealType: string }): string {
  return `${slot.date}|${slot.mealType}`
}
