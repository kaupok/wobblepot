import 'server-only'
import { z } from 'zod'
import { fuzzySearchIngredient } from '@/lib/ai/fuzzy-ingredient-match'
import { matchIngredients } from '@/lib/ai/match-ingredients'
import { translateIngredientNames } from '@/lib/ai/translate-match-results'
import { displayUnit } from '@/lib/i18n/format-shopping-quantity'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import {
  createPantryItem,
  findPantryIngredient,
  updatePantryItem,
  type PantryItemWithIngredient,
} from '@/lib/pantry/pantry-items'

type Ingredient = PantryItemWithIngredient['ingredient']

function itemOutput(ingredient: Ingredient, item: PantryItemWithIngredient | null) {
  return {
    ingredientId: ingredient.id,
    name: ingredient.name,
    quantity: item?.quantity ?? null,
    unit: displayUnit(ingredient),
    isStaple: item?.isStaple ?? false,
  }
}

const UNKNOWN_ID =
  'Wobblepot has no ingredient with this id. Use an ingredientId from get_pantry or get_shopping_list, or leave it out to match the name. Nothing was changed.'

export const setStaple = defineTool({
  name: 'set_staple',
  title: 'Star or unstar a staple',
  description:
    'Makes an ingredient a staple, or stops it being one. A staple is something the household keeps at home all the time, such as rice or eggs: when it is marked ran_out (set_pantry_status), it goes on the shopping list even when no planned meal needs it. Give the name as the user says it, in English or Estonian. Pass ingredientId as well when you have it from get_pantry or get_shopping_list; it wins over the name. Wobblepot matches the name to its ingredient list, and only a sure match is saved. With no sure match, nothing is saved and outcome is unmatched with the closest ingredients; ask the user which one they meant and call again with its ingredientId. Starring puts the ingredient in the pantry if it is not there yet. Neither starring nor unstarring changes the amount at home, and unstarring keeps the item in the pantry. Call it once per ingredient.',
  annotations: WRITE_ANNOTATIONS,
  inputSchema: z.object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .describe('The ingredient alone, in the user’s words: "rice", "tatar".'),
    ingredientId: z
      .string()
      .min(1)
      .optional()
      .describe('The ingredientId from get_pantry or get_shopping_list, when you have it.'),
    staple: z.boolean().describe('true: make it a staple. false: stop it being one.'),
  }),
  outputSchema: z.object({
    outcome: z
      .enum(['created', 'updated', 'unchanged', 'unmatched'])
      .describe(
        'created: the ingredient was not in the pantry and now is, as a staple. updated: the staple flag changed. unchanged: it already had this flag, so nothing was saved. unmatched: the name had no sure match, so nothing was saved.',
      ),
    item: z
      .object({
        ingredientId: z.string(),
        name: z.string(),
        quantity: z
          .number()
          .nullable()
          .describe('The amount at home, as get_pantry reports it. Never changed by this tool.'),
        unit: z.string(),
        isStaple: z.boolean(),
      })
      .nullable()
      .describe('The ingredient as it is now. null for unmatched.'),
    candidates: z
      .array(z.object({ ingredientId: z.string(), name: z.string() }))
      .describe('For unmatched: the closest ingredients Wobblepot has, at most 3.'),
  }),
  run: async (household, { name, ingredientId, staple }) => {
    let id = ingredientId
    if (id === undefined) {
      const locale = resolveHouseholdLocale(household)
      const searchOptions = { householdId: household.id, locale }
      const [result] = await matchIngredients(
        [
          {
            name,
            quantity: null,
            unit: null,
            originalText: name,
            isVague: false,
            vaguePhrase: null,
            isDried: null,
          },
        ],
        1,
        searchOptions,
      )
      if (!result) throw new Error('matchIngredients returned no result for one item')

      if (result.type !== 'matched' || result.lowConfidence) {
        const closest =
          result.type === 'matched'
            ? (result.alternatives ?? [])
            : (await fuzzySearchIngredient(name, searchOptions)).slice(0, 3)
        const candidates = await translateIngredientNames(closest, locale)
        return {
          outcome: 'unmatched' as const,
          item: null,
          candidates: candidates.map((c) => ({ ingredientId: c.id, name: c.name })),
        }
      }
      id = result.ingredient.id
    }

    const found = await findPantryIngredient(household, id)
    if (found.status === 'ingredient_not_found') throw new ToolInputError(UNKNOWN_ID)
    const { ingredient, item } = found

    if ((item?.isStaple ?? false) === staple) {
      return { outcome: 'unchanged' as const, item: itemOutput(ingredient, item), candidates: [] }
    }

    let existingId = item?.id
    if (!existingId) {
      // Only `staple: true` gets here: no item reads as not a staple.
      const created = await createPantryItem(household, {
        ingredientId: id,
        quantity: null,
        isStaple: true,
      })
      // The ingredient was deleted after the read above.
      if (created.status === 'ingredient_not_found') throw new ToolInputError(UNKNOWN_ID)
      if (created.status === 'created') {
        return {
          outcome: 'created' as const,
          item: itemOutput(created.item.ingredient, created.item),
          candidates: [],
        }
      }
      // A concurrent request added the ingredient first.
      existingId = created.existingId
    }

    // Only the flag changes, so the amount at home stays as it is.
    const updated = await updatePantryItem(household, existingId, { isStaple: staple })
    if (updated.status === 'not_found') {
      // The household removed the item after it was read.
      throw new ToolInputError('The pantry changed while this ran. Try again.')
    }
    return {
      outcome: 'updated' as const,
      item: itemOutput(updated.item.ingredient, updated.item),
      candidates: [],
    }
  },
})
