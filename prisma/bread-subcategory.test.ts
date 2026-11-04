import { expect, it } from 'vitest'

import { defaultCookOutcome } from '@/lib/pantry/cook-outcome'

import { baseIngredients } from './seed'

// A 'grain' row is a cupboard item, so the Cooked dialog would keep bread in
// the pantry (HON-1576).
it.each([
  ['bread', 'bread'],
  ['tortilla', 'flatbread'],
])('seeds %s as carb/%s, so cooking with it uses it up', (name, subcategory) => {
  const row = baseIngredients.find((i) => i.name === name)
  expect(row).toMatchObject({ category: 'carb', subcategory })
  expect(
    defaultCookOutcome({
      pantryQuantity: null,
      isStaple: false,
      category: row!.category,
      subcategory: row!.subcategory,
      defaultUnit: row!.defaultUnit,
      amountUsed: 100,
    }),
  ).toBe('usedUp')
})
