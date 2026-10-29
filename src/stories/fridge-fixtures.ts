import type { FridgeMealItem, PantryItemFull } from '@/components/meal-plan/types'
import type { LeftoverSource } from '@/lib/meal-plans/recent-meals'

import { createPantryItem } from './fixtures'

// The fridge-meal scenario (HON-1277): yesterday's mash, a frozen vegetable
// mix, cucumber and paprika on the side, and store meatballs.

const pantry = (ingredientId: string, name: string, quantity: number | null) =>
  createPantryItem({
    ingredientId,
    quantity,
    ingredient: { id: ingredientId, name, category: 'vegetable', defaultUnit: 'g' },
  })

export const fridgePantryItems: PantryItemFull[] = [
  pantry('cucumber', 'Cucumber', 300),
  pantry('paprika', 'Paprika', 2),
  pantry('veg-mix', 'Cauliflower and broccoli mix', 400),
  pantry('butter', 'Butter', null),
]

/** Tuesday 20 October 2026: the mash's day. */
export const MASH_DATE = '2026-10-20'

export const fridgeRecentMeals: LeftoverSource[] = [
  {
    entryId: 'entry-mash',
    mealName: 'Mash',
    date: MASH_DATE,
    mealType: 'dinner',
    sourceState: 'completed',
  },
  {
    entryId: 'entry-soup',
    mealName: 'Lentil soup',
    date: '2026-10-19',
    mealType: 'dinner',
    sourceState: 'completed',
  },
]

/** Wednesday's dinner, still to cook: a source for Thursday's lunch (HON-1396). */
export const fridgePlannedSource: LeftoverSource = {
  entryId: 'entry-curry',
  mealName: 'Chicken curry',
  date: '2026-10-21',
  mealType: 'dinner',
  sourceState: 'planned',
}

/** The household's own servings in the stories: two adults and a child. */
export const FRIDGE_DEFAULT_SERVINGS = 2.5

export const fridgeItems: FridgeMealItem[] = [
  {
    id: 'item-mash',
    ingredientId: null,
    sourceEntryId: 'entry-mash',
    label: null,
    name: 'Mash',
    sourceDate: MASH_DATE,
    servings: null,
  },
  {
    id: 'item-veg',
    ingredientId: 'veg-mix',
    sourceEntryId: null,
    label: null,
    name: 'Cauliflower and broccoli mix',
    sourceDate: null,
    servings: null,
  },
  {
    id: 'item-cucumber',
    ingredientId: 'cucumber',
    sourceEntryId: null,
    label: null,
    name: 'Cucumber',
    sourceDate: null,
    servings: null,
  },
  {
    id: 'item-meatballs',
    ingredientId: null,
    sourceEntryId: null,
    label: 'store meatballs',
    name: null,
    sourceDate: null,
    servings: null,
  },
]

/**
 * Tomorrow's lunch from tonight's dinner (HON-1395): Tuesday's roast, still
 * planned, gives this lunch 2.5 servings.
 */
export const plannedLeftoverItem: FridgeMealItem = {
  id: 'item-roast',
  ingredientId: null,
  sourceEntryId: 'entry-roast',
  label: null,
  name: 'Roast chicken',
  sourceDate: MASH_DATE,
  servings: 2.5,
  sourceMealType: 'dinner',
  sourceState: 'planned',
}

/** The same lunch once the roast is skipped: there will be no leftovers. */
export const skippedLeftoverItem: FridgeMealItem = { ...plannedLeftoverItem, sourceState: 'gone' }
