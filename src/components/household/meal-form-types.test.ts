import { describe, it, expect, vi } from 'vitest'
vi.unmock('next-intl')
import { createTranslator } from 'next-intl'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import type { IngredientRowData } from '@/components/recipes/IngredientRow'
import {
  buildFinalComponents,
  mealComponentErrorMessage,
  type IngredientResult,
  type MealComponent,
} from './meal-form-types'

function ingredient(name: string): IngredientResult {
  return {
    id: name.toLowerCase(),
    name,
    category: 'vegetable',
    defaultUnit: 'g',
    gramsPerPiece: null,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  }
}

function component(name: string, totalQuantity: number): MealComponent {
  return { ingredientId: name.toLowerCase(), ingredient: ingredient(name), totalQuantity }
}

function unmatched(extractedName: string): IngredientRowData {
  return {
    type: 'unmatched',
    extractedName,
    originalText: extractedName,
    extractedQuantity: 1,
    extractedUnit: '',
  }
}

describe('buildFinalComponents', () => {
  it('reports no_ingredients when there are none', () => {
    expect(buildFinalComponents(false, [], [])).toEqual({
      error: { code: 'no_ingredients', names: [] },
    })
  })

  it('names every component with a non-positive quantity', () => {
    const result = buildFinalComponents(
      false,
      [],
      [component('Rice', 0), component('Leek', 100), component('Egg', -1)],
    )
    expect(result).toEqual({ error: { code: 'invalid_quantity', names: ['Rice', 'Egg'] } })
  })

  it('names unresolved import rows before anything else', () => {
    const result = buildFinalComponents(true, [unmatched('Pickled daikon')], [])
    expect(result).toEqual({ error: { code: 'unmatched', names: ['Pickled daikon'] } })
  })
})

// HON-773: the validator used to return English prose that both callers
// rendered verbatim, so an Estonian household saw English.
describe('mealComponentErrorMessage', () => {
  // The app's `useTranslations` is untyped, so widen the catalogue-typed
  // translator to the helper's plain `t` signature.
  function translator(locale: 'en' | 'et') {
    const t = createTranslator({
      locale,
      messages: locale === 'en' ? enMessages : etMessages,
      namespace: 'recipes.form',
    })
    return (key: string, values?: Record<string, string | number>) =>
      t(key as never, values as never)
  }
  const tEn = translator('en')
  const tEt = translator('et')

  it('renders no_ingredients in Estonian', () => {
    const message = mealComponentErrorMessage({ code: 'no_ingredients', names: [] }, tEt, 'et')
    expect(message).toBe(etMessages.recipes.form.errors.noIngredients)
    expect(message).not.toBe(enMessages.recipes.form.errors.noIngredients)
  })

  it('lists up to three names and counts the rest', () => {
    const names = ['Rice', 'Leek', 'Egg', 'Salt', 'Oil']
    expect(mealComponentErrorMessage({ code: 'unmatched', names }, tEn, 'en')).toBe(
      'Resolve unmatched ingredients: Rice, Leek, Egg +2 more',
    )
    expect(mealComponentErrorMessage({ code: 'invalid_quantity', names }, tEt, 'et')).toBe(
      'Kogus peab olema suurem kui 0: Rice, Leek, Egg +2 veel',
    )
  })

  it('adds no count when every name fits', () => {
    expect(
      mealComponentErrorMessage({ code: 'unverified', names: ['Rice', 'Leek'] }, tEn, 'en'),
    ).toBe('Verify matches before saving: Rice, Leek')
  })
})
