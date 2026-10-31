import 'server-only'

import { z } from 'zod'

import { translateIngredientNames } from '@/lib/ai/translate-match-results'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import {
  addCustomShoppingItem,
  customItemNameSchema,
  type CustomItemWithIngredient,
} from '@/lib/shopping/custom-items'

export const addShoppingItem = defineTool({
  name: 'add_shopping_item',
  title: 'Add shopping item',
  description:
    'Adds an item to the shopping list by name, such as "dish soap" or "milk". It shows among the items the household added by hand (customItems in get_shopping_list). An item with the same name is not added twice: if it was checked off, it goes back on the list. The item links to an ingredient only when the name matches one surely; item.ingredient is null otherwise, and checking that item off will not stock the pantry.',
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false },
  inputSchema: z.object({
    name: customItemNameSchema.describe(
      'What to buy, as the household would write it on the list, in its own language.',
    ),
  }),
  outputSchema: z.object({
    outcome: z
      .enum(['added', 'back_on_list', 'already_on_list'])
      .describe(
        'added: a new item. back_on_list: it was checked off and is unchecked again. already_on_list: it was on the list already, so nothing changed.',
      ),
    item: z.object({
      id: z.string(),
      name: z.string(),
      checked: z.boolean(),
      ingredient: z
        .object({ ingredientId: z.string(), name: z.string() })
        .nullable()
        .describe(
          "The ingredient the item links to, named in the household's language. null: no link, so checking the item off will not stock the pantry.",
        ),
    }),
  }),
  run: async (household, { name }) => {
    const outcome = await addCustomShoppingItem(household, name)
    const locale = resolveHouseholdLocale(household)
    // The ingredient is named in the household's language.
    const view = async ({ id, name, checked, ingredient }: CustomItemWithIngredient) => {
      const [linked] = ingredient ? await translateIngredientNames([ingredient], locale) : []
      return {
        id,
        name,
        checked,
        ingredient: linked ? { ingredientId: linked.id, name: linked.name } : null,
      }
    }
    switch (outcome.status) {
      case 'created':
      case 'reopened':
        return {
          outcome: outcome.status === 'created' ? ('added' as const) : ('back_on_list' as const),
          item: await view(outcome.item),
        }
      case 'exists': {
        if (!outcome.existing) {
          throw new ToolInputError('This item is already on the shopping list.')
        }
        return { outcome: 'already_on_list' as const, item: await view(outcome.existing) }
      }
    }
  },
})
