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

/** A known-quantity row with some left: 1000 g of mince, 125 g a serving (HON-1583). */
export const minceComponent: MealComponent = createMealComponent({
  ingredientId: 'mince',
  quantityPerServing: 125,
  ingredient: { id: 'mince', name: 'Beef mince', category: 'protein', defaultUnit: 'g' },
})

export const mincePantryItem: PantryItemFull = createPantryItem({
  ingredientId: 'mince',
  quantity: 1000,
  ingredient: {
    id: 'mince',
    name: 'Beef mince',
    category: 'protein',
    subcategory: null,
    defaultUnit: 'g',
  },
})

// Staples the meal uses (HON-1588): onion is asked about, salt is a starter
// staple and chili flakes are "to taste", so neither gets a row.
const staple = (id: string, name: string, category: string, quantityPerServing = 25) => ({
  component: createMealComponent({
    ingredientId: id,
    quantityPerServing,
    ingredient: { id, name, category, defaultUnit: 'g' },
  }),
  pantryItem: createPantryItem({
    ingredientId: id,
    quantity: null,
    isStaple: true,
    ingredient: { id, name, category, subcategory: null, defaultUnit: 'g' },
  }),
})

const onion = staple('onion', 'Onion', 'vegetable')
const salt = staple('salt', 'Salt', 'spice', 1)
const chili = staple('chili-flakes', 'Chili flakes', 'spice', 0)

export const onionComponent: MealComponent = onion.component
export const onionPantryItem: PantryItemFull = onion.pantryItem
export const saltComponent: MealComponent = salt.component
export const saltPantryItem: PantryItemFull = { ...salt.pantryItem, starterStaple: true }
export const chiliToTasteComponent: MealComponent = {
  ...chili.component,
  isVague: true,
  originalPhrase: 'to taste',
}
export const chiliPantryItem: PantryItemFull = chili.pantryItem
