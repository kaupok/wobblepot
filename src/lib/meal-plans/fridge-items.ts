import { z } from 'zod'

/**
 * The items of a fridge meal (HON-1277), as the client sends them. Shared by
 * the entry routes, the persistence in `fridge-meal.ts` and the picker, so the
 * three cannot drift. An item has exactly one source, as the table's CHECK
 * holds: a pantry ingredient, a recently completed entry's leftovers, or free
 * text.
 */

/** Longest free-text item, so a pasted paragraph cannot become one item. */
export const FRIDGE_ITEM_LABEL_MAX = 80
/** Most items one fridge meal holds. */
export const FRIDGE_ITEMS_MAX = 30

export const fridgeItemSchema = z.union([
  z.object({ ingredientId: z.string().min(1) }).strict(),
  z.object({ sourceEntryId: z.string().min(1) }).strict(),
  z.object({ label: z.string().trim().min(1).max(FRIDGE_ITEM_LABEL_MAX) }).strict(),
])

export const fridgeItemsSchema = z.array(fridgeItemSchema).min(1).max(FRIDGE_ITEMS_MAX)

export type FridgeItemInput = z.infer<typeof fridgeItemSchema>
