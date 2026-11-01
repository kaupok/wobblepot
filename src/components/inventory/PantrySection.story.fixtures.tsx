import { http, HttpResponse } from 'msw'
import { type ComponentProps, useState } from 'react'

import type { PantryItemData } from '@/components/pantry/PantryItem'
import { createPantryItemData } from '@/stories/fixtures'

import { PantrySection } from './PantrySection'

// Shared by the PantrySection stories, which are split across
// PantrySection.stories.tsx and PantrySection.ran-out.stories.tsx for the
// file-size cap. (PantrySection.fixtures.tsx is the tests' copy; it imports
// vitest, so a story cannot use it.)

type Ingredient = PantryItemData['ingredient']

export const ingredient = (
  id: string,
  name: string,
  category: Ingredient['category'],
  defaultUnit: Ingredient['defaultUnit'] = 'g',
): Ingredient => ({ id, name, category, defaultUnit })

export const staples: PantryItemData[] = [
  createPantryItemData({ ingredient: ingredient('olive-oil', 'Olive oil', 'fat'), isStaple: true }),
  createPantryItemData({ ingredient: ingredient('salt', 'Salt', 'condiment'), isStaple: true }),
]

export const onHand: PantryItemData[] = [
  createPantryItemData({ ingredient: ingredient('garlic', 'Garlic', 'vegetable', 'piece') }),
  createPantryItemData({ ingredient: ingredient('lemon', 'Lemon', 'fruit', 'piece') }),
  createPantryItemData({ ingredient: ingredient('short-grain-rice', 'Short-grain rice', 'carb') }),
]

// Quantity 0 is "ran out" (docs/PROJECT_SPEC.md → Pantry Quantity Semantics),
// as the fridge meal's "Used it all" leaves a row.
export const ranOut: PantryItemData[] = [
  createPantryItemData({
    ingredient: ingredient('avocado', 'Avocado', 'fruit', 'piece'),
    quantity: 0,
  }),
  createPantryItemData({ ingredient: ingredient('lime', 'Lime', 'fruit', 'piece'), quantity: 0 }),
]

/**
 * `PantrySection` is controlled — `InventoryPage` owns the list and passes its
 * `setState` as `onItemsChange`. Holding the list here lets a star toggle or a
 * removal actually move the row, while the spy still records each call.
 */
export function StatefulPantrySection({
  items: initialItems,
  onItemsChange,
  ...props
}: ComponentProps<typeof PantrySection>) {
  const [items, setItems] = useState(initialItems)
  return (
    <PantrySection
      {...props}
      items={items}
      onItemsChange={(update) => {
        onItemsChange(update)
        setItems(update)
      }}
    />
  )
}

/** Answers the switch's flips and an amount as the route does. */
export const patchHandler = http.patch('/api/pantry/:id', () => HttpResponse.json({ ok: true }))
