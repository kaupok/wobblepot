import { z } from 'zod'

/**
 * The limits on a household recipe's own fields, shared by
 * `POST /api/households/me/meals` and the MCP tool `create_meal` (HON-1305),
 * so the two ways to add a recipe cannot drift apart. Each adds its own
 * ingredient list: ids from the app, names the tool matches.
 */
export const mealFieldsSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullish(),
  preparationNotes: z.string().max(5000).nullish(),
  sourceUrl: z
    .string()
    .url()
    .max(2000)
    .refine((url) => /^https?:\/\//i.test(url), 'Only http/https URLs are allowed')
    .nullish(),
  timeMinutes: z.number().int().positive().max(480).nullish(),
  kidFriendly: z.boolean().optional().default(false),
  suitableFor: z.array(z.enum(['breakfast', 'lunch', 'dinner'])).min(1),
  servings: z.number().int().positive().max(50),
})
