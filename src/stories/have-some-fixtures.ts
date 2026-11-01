import type { MealComponent, PantryItemFull } from '@/components/meal-plan/types'

import { createMealComponent, createPantryItem } from './fixtures'

// The HON-1563 real case: a roast vegetable bowl cooked for 4 from a pantry
// where every row is "have some" (`quantity: null`). `defaultCookOutcome`
// marks the four fresh vegetables used up and keeps the cupboard items and
// half a lemon (HON-1564).

interface HaveSomeIngredient {
  id: string
  name: string
  category: string
  subcategory: string | null
  defaultUnit: 'g' | 'piece'
  quantityPerServing: number
}

const bowl: HaveSomeIngredient[] = [
  {
    id: 'pumpkin',
    name: 'Pumpkin',
    category: 'vegetable',
    subcategory: null,
    defaultUnit: 'g',
    quantityPerServing: 300,
  },
  {
    id: 'carrot',
    name: 'Carrot',
    category: 'vegetable',
    subcategory: null,
    defaultUnit: 'g',
    quantityPerServing: 100,
  },
  {
    id: 'sweet-potato',
    name: 'Sweet potato',
    category: 'vegetable',
    subcategory: null,
    defaultUnit: 'g',
    quantityPerServing: 150,
  },
  {
    id: 'beetroot',
    name: 'Beetroot',
    category: 'vegetable',
    subcategory: null,
    defaultUnit: 'g',
    quantityPerServing: 100,
  },
  {
    id: 'cumin',
    name: 'Cumin',
    category: 'spice',
    subcategory: null,
    defaultUnit: 'g',
    quantityPerServing: 2,
  },
  {
    id: 'smoked-paprika',
    name: 'Smoked paprika',
    category: 'spice',
    subcategory: 'chili',
    defaultUnit: 'g',
    quantityPerServing: 2,
  },
  {
    id: 'tahini',
    name: 'Tahini',
    category: 'condiment',
    subcategory: 'spread',
    defaultUnit: 'g',
    quantityPerServing: 15,
  },
  {
    id: 'quinoa',
    name: 'Quinoa',
    category: 'carb',
    subcategory: 'grain',
    defaultUnit: 'g',
    quantityPerServing: 60,
  },
  {
    id: 'chickpeas',
    name: 'Chickpeas',
    category: 'legume',
    subcategory: 'bean',
    defaultUnit: 'g',
    quantityPerServing: 60,
  },
  {
    id: 'pumpkin-seeds',
    name: 'Pumpkin seeds',
    category: 'fat',
    subcategory: 'seed',
    defaultUnit: 'g',
    quantityPerServing: 10,
  },
  // Half a lemon across 4 servings.
  {
    id: 'lemon',
    name: 'Lemon',
    category: 'fruit',
    subcategory: null,
    defaultUnit: 'piece',
    quantityPerServing: 0.125,
  },
]

export const HAVE_SOME_SERVINGS = 4

export const haveSomeComponents: MealComponent[] = bowl.map(
  ({ id, name, category, defaultUnit, quantityPerServing }) =>
    createMealComponent({
      ingredientId: id,
      quantityPerServing,
      ingredient: { id, name, category, defaultUnit },
    }),
)

export const haveSomePantryItems: PantryItemFull[] = bowl.map(
  ({ id, name, category, subcategory, defaultUnit }) =>
    createPantryItem({
      ingredientId: id,
      quantity: null,
      ingredient: { id, name, category, subcategory, defaultUnit },
    }),
)

/** A known-quantity row the meal runs out: 100 g of feta, 30 g a serving. */
export const fetaComponent: MealComponent = createMealComponent({
  ingredientId: 'feta',
  quantityPerServing: 30,
  ingredient: { id: 'feta', name: 'Feta', category: 'dairy', defaultUnit: 'g' },
})

export const fetaPantryItem: PantryItemFull = createPantryItem({
  ingredientId: 'feta',
  quantity: 100,
  ingredient: { id: 'feta', name: 'Feta', category: 'dairy', subcategory: null, defaultUnit: 'g' },
})
