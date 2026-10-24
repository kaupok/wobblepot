import type { DayExtraView } from '@/components/meal-plan/types'
import type { IngredientResult } from '@/hooks/use-ingredient-search'
import { timelineTodayDate } from './fixtures'

// The day extras scenario (HON-1309): wine for dinner, a bag of chips for
// movie night, and eggs with no amount yet.

export const extraSearchResults: IngredientResult[] = [
  {
    id: 'ing-wine',
    name: 'Red wine',
    category: 'condiment',
    defaultUnit: 'g',
    measuredByVolume: true,
  },
  {
    id: 'ing-white-wine',
    name: 'White wine',
    category: 'condiment',
    defaultUnit: 'g',
    measuredByVolume: true,
  },
  { id: 'ing-eggs', name: 'Eggs', category: 'protein', defaultUnit: 'piece' },
  { id: 'ing-olives', name: 'Olives', category: 'vegetable', defaultUnit: 'g' },
]

export const wineExtra: DayExtraView = {
  id: 'extra-wine',
  date: timelineTodayDate,
  ingredientId: 'ing-wine',
  name: 'Red wine',
  quantity: 750,
  unit: 'ml',
}

export const chipsExtra: DayExtraView = {
  id: 'extra-chips',
  date: timelineTodayDate,
  ingredientId: null,
  name: 'chips',
  quantity: null,
  unit: null,
}

export const eggsExtra: DayExtraView = {
  id: 'extra-eggs',
  date: timelineTodayDate,
  ingredientId: 'ing-eggs',
  name: 'Eggs',
  quantity: null,
  unit: 'piece',
}

/** One of each kind: an amount, free text, and an ingredient with no amount. */
export const mixedExtras: DayExtraView[] = [wineExtra, chipsExtra, eggsExtra]
