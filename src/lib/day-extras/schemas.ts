import { z } from 'zod'

/**
 * The bodies of the day extras routes (HON-1309), shared by the routes and the
 * persistence in `day-extras.ts`. An extra is a catalogue ingredient with an
 * optional amount, or free text with none, as the table's CHECK holds.
 */

/** Longest free-text extra, so a pasted paragraph cannot become one item. */
export const DAY_EXTRA_LABEL_MAX = 80
/** Largest amount, in the ingredient's `defaultUnit`: 100 kg, 100 l or 100 000 pieces. */
export const DAY_EXTRA_QUANTITY_MAX = 100_000

/** An amount above 0, or null for "no amount". */
export const dayExtraQuantitySchema = z.number().positive().max(DAY_EXTRA_QUANTITY_MAX).nullable()

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')

export const createDayExtraSchema = z.union([
  z
    .object({
      date: dateSchema,
      ingredientId: z.string().min(1),
      quantity: dayExtraQuantitySchema.optional(),
    })
    .strict(),
  z.object({ date: dateSchema, label: z.string().trim().min(1).max(DAY_EXTRA_LABEL_MAX) }).strict(),
])

export type CreateDayExtraInput = z.infer<typeof createDayExtraSchema>

export const updateDayExtraSchema = z.object({ quantity: dayExtraQuantitySchema }).strict()
