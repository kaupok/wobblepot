import { describe, it, expect } from 'vitest'
import {
  ingredientTranslationsInclude,
  mealTranslationsInclude,
  translateIngredient,
  translateIngredients,
  translateMeal,
  translateMeals,
} from './content'

describe('ingredientTranslationsInclude', () => {
  it('returns empty object for the default locale (no JOIN)', () => {
    expect(ingredientTranslationsInclude('en')).toEqual({})
  })

  it('returns a fragment with explicit field selection for non-default locales', () => {
    expect(ingredientTranslationsInclude('et')).toEqual({
      translations: {
        where: { locale: 'et' },
        take: 1,
        select: { locale: true, name: true },
      },
    })
  })
})

describe('mealTranslationsInclude', () => {
  it('returns empty object for the default locale', () => {
    expect(mealTranslationsInclude('en')).toEqual({})
  })

  it('returns a fragment with explicit field selection for non-default locales', () => {
    expect(mealTranslationsInclude('et')).toEqual({
      translations: {
        where: { locale: 'et' },
        take: 1,
        select: {
          locale: true,
          name: true,
          description: true,
          preparationNotes: true,
        },
      },
    })
  })
})

describe('translateIngredient', () => {
  it('passes through unchanged for English', () => {
    const ing = { id: '1', name: 'onion' }
    expect(translateIngredient(ing, 'en')).toBe(ing)
  })

  it('falls back to English when no translation present', () => {
    const ing = { id: '1', name: 'onion', translations: [] }
    expect(translateIngredient(ing, 'et').name).toBe('onion')
  })

  it('falls back to English when translation array is omitted', () => {
    const ing = { id: '1', name: 'onion' }
    expect(translateIngredient(ing, 'et').name).toBe('onion')
  })

  it('overrides name when matching translation exists', () => {
    const ing = {
      id: '1',
      name: 'onion',
      translations: [{ locale: 'et', name: 'sibul' }],
    }
    expect(translateIngredient(ing, 'et').name).toBe('sibul')
  })

  it('preserves other fields when overriding name', () => {
    const ing = {
      id: '1',
      name: 'onion',
      category: 'vegetable',
      translations: [{ locale: 'et', name: 'sibul' }],
    }
    const out = translateIngredient(ing, 'et')
    expect(out.category).toBe('vegetable')
    expect(out.id).toBe('1')
  })

  it('ignores translations for other locales', () => {
    const ing = {
      id: '1',
      name: 'onion',
      translations: [{ locale: 'fr', name: 'oignon' }],
    }
    expect(translateIngredient(ing, 'et').name).toBe('onion')
  })
})

describe('translateIngredients', () => {
  it('returns the input array unchanged for English', () => {
    const list = [{ id: '1', name: 'onion' }]
    expect(translateIngredients(list, 'en')).toBe(list)
  })

  it('translates each ingredient', () => {
    const list = [
      { id: '1', name: 'onion', translations: [{ locale: 'et', name: 'sibul' }] },
      { id: '2', name: 'garlic', translations: [] },
    ]
    const out = translateIngredients(list, 'et')
    expect(out.map((i) => i.name)).toEqual(['sibul', 'garlic'])
  })
})

describe('translateMeal', () => {
  const baseMeal = {
    id: 'm1',
    name: 'Carbonara',
    description: 'Classic Roman pasta',
    preparationNotes: 'Use guanciale',
  }

  it('passes through unchanged for English', () => {
    expect(translateMeal(baseMeal, 'en')).toBe(baseMeal)
  })

  it('falls back to English when no translation present', () => {
    const out = translateMeal({ ...baseMeal, translations: [] }, 'et')
    expect(out.name).toBe('Carbonara')
    expect(out.description).toBe('Classic Roman pasta')
    expect(out.preparationNotes).toBe('Use guanciale')
  })

  it('overrides all fields when full translation provided', () => {
    const out = translateMeal(
      {
        ...baseMeal,
        translations: [
          {
            locale: 'et',
            name: 'Carbonara (et)',
            description: 'Klassikaline Rooma pasta',
            preparationNotes: 'Kasuta guancialet',
          },
        ],
      },
      'et',
    )
    expect(out.name).toBe('Carbonara (et)')
    expect(out.description).toBe('Klassikaline Rooma pasta')
    expect(out.preparationNotes).toBe('Kasuta guancialet')
  })

  it('falls back per-field when translation omits optional fields', () => {
    const out = translateMeal(
      {
        ...baseMeal,
        translations: [
          {
            locale: 'et',
            name: 'Carbonara (et)',
            description: null,
            preparationNotes: null,
          },
        ],
      },
      'et',
    )
    expect(out.name).toBe('Carbonara (et)')
    expect(out.description).toBe('Classic Roman pasta')
    expect(out.preparationNotes).toBe('Use guanciale')
  })

  it('handles meals with null English description gracefully', () => {
    const out = translateMeal(
      {
        id: 'm2',
        name: 'Toast',
        description: null,
        preparationNotes: null,
        translations: [
          { locale: 'et', name: 'Röstsai', description: null, preparationNotes: null },
        ],
      },
      'et',
    )
    expect(out.name).toBe('Röstsai')
    expect(out.description).toBeNull()
    expect(out.preparationNotes).toBeNull()
  })
})

describe('translateMeals', () => {
  it('returns the input array unchanged for English', () => {
    const list = [{ id: '1', name: 'Pasta', description: null, preparationNotes: null }]
    expect(translateMeals(list, 'en')).toBe(list)
  })

  it('translates each meal independently', () => {
    const list = [
      {
        id: '1',
        name: 'Pasta',
        description: 'a',
        preparationNotes: null,
        translations: [
          { locale: 'et', name: 'Pasta-et', description: null, preparationNotes: null },
        ],
      },
      {
        id: '2',
        name: 'Salad',
        description: 'b',
        preparationNotes: null,
        translations: [],
      },
    ]
    const out = translateMeals(list, 'et')
    expect(out.map((m) => m.name)).toEqual(['Pasta-et', 'Salad'])
  })
})
