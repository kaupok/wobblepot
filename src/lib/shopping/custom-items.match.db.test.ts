import { describe, expect, it } from 'vitest'

import type { IngredientCategory } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { addCustomShoppingItem } from '@/lib/shopping/custom-items'

// Runs against PGlite through the `unit-db` project, with no mocks. Which
// ingredient a typed name links to, so checking the item off stocks the right
// food or none (HON-1498). The rest of `addCustomShoppingItem` is covered in
// `custom-items.db.test.ts`.

/**
 * Alder (English) and Birch (Estonian), and catalogue names as
 * `prisma/seed-ingredient-translations-et.ts` writes them, because the
 * migrations seed no Estonian names. The spice is created first: "paprika"
 * scores 1.0 on both, and the old match took the first row it read.
 */
async function world() {
  const alder = await prisma.household.create({ data: { id: 'hh-alder', name: 'Alder' } })
  const birch = await prisma.household.create({
    data: { id: 'hh-birch', name: 'Birch', locale: 'et' },
  })
  const global = (id: string, name: string, et: string, category: IngredientCategory) =>
    prisma.ingredient.create({
      data: {
        id,
        name,
        category,
        defaultUnit: 'g',
        calories: 1,
        protein: 0,
        carbs: 0,
        fat: 0,
        translations: { create: { locale: 'et', name: et } },
      },
    })
  await global('ing-paprika', 'paprika', 'paprikapulber', 'spice')
  await global('ing-bell-pepper', 'bell pepper', 'paprika', 'vegetable')
  await global('ing-broccoli', 'broccoli', 'brokoli', 'vegetable')
  await global(
    'ing-frozen-mix',
    'frozen broccoli and cauliflower mix',
    'külmutatud brokoli-lillkapsasegu',
    'vegetable',
  )
  await global('ing-frozen-peas', 'frozen peas', 'külmutatud herned', 'vegetable')
  await global('ing-frozen-strawberries', 'frozen strawberries', 'külmutatud maasikad', 'fruit')
  await global('ing-rice', 'rice', 'riis', 'carb')
  return { alder, birch }
}

describe('addCustomShoppingItem ingredient link', () => {
  it('links an Estonian "paprika" to bell pepper, not to the spice', async () => {
    const { birch } = await world()

    const outcome = await addCustomShoppingItem(birch, 'paprika')

    expect(outcome).toMatchObject({ status: 'created', item: { ingredientId: 'ing-bell-pepper' } })
  })

  it('leaves "külmutatud brokoli" unlinked rather than linking a frozen ingredient it is not', async () => {
    const { birch } = await world()

    const outcome = await addCustomShoppingItem(birch, 'külmutatud brokoli')

    expect(outcome).toMatchObject({
      status: 'created',
      item: { name: 'külmutatud brokoli', ingredientId: null, ingredient: null },
    })
  })

  it("links an English household's exact English name", async () => {
    const { alder } = await world()

    const outcome = await addCustomShoppingItem(alder, 'rice')

    expect(outcome).toMatchObject({ status: 'created', item: { ingredientId: 'ing-rice' } })
  })
})
