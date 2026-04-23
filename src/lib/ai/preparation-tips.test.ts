import { describe, it, expect } from 'vitest'
import {
  buildFullTipsPrompt,
  buildSupplementaryTipsPrompt,
  type PrepTipsPromptInput,
  type SupplementaryPrepTipsPromptInput,
} from './preparation-tips'

function fullInput(overrides: Partial<PrepTipsPromptInput> = {}): PrepTipsPromptInput {
  return {
    mealName: 'Chicken stir fry',
    householdSize: 4,
    timeMinutes: 30,
    ingredientsList: '- Chicken breast: 600g\n- Rice: 320g',
    locale: 'en',
    ...overrides,
  }
}

function supplementaryInput(
  overrides: Partial<SupplementaryPrepTipsPromptInput> = {},
): SupplementaryPrepTipsPromptInput {
  return {
    mealName: 'Chicken stir fry',
    householdSize: 4,
    timeMinutes: 30,
    ingredientsList: '- Chicken breast: 600g\n- Rice: 320g',
    preparationNotes: 'Sear chicken first, then add vegetables.',
    locale: 'en',
    ...overrides,
  }
}

describe('buildFullTipsPrompt', () => {
  it('includes meal name, servings, and ingredients', () => {
    const result = buildFullTipsPrompt(fullInput())

    expect(result).toContain('Meal: Chicken stir fry')
    expect(result).toContain('Servings: 4')
    expect(result).toContain('Time budget: 30 minutes')
    expect(result).toContain('- Chicken breast: 600g')
  })

  it('omits the time-budget line when timeMinutes is null', () => {
    const result = buildFullTipsPrompt(fullInput({ timeMinutes: null }))

    expect(result).not.toContain('Time budget')
  })

  it('does not reference user preparation notes', () => {
    const result = buildFullTipsPrompt(fullInput())

    expect(result).not.toContain("User's preparation notes")
  })

  it('omits the locale instruction block for the default (English) locale', () => {
    const result = buildFullTipsPrompt(fullInput({ locale: 'en' }))

    expect(result).not.toContain('LOCALE:')
  })

  it('injects the Estonian instruction when locale is "et"', () => {
    const result = buildFullTipsPrompt(fullInput({ locale: 'et' }))

    expect(result).toContain('LOCALE:')
    expect(result).toContain('Estonian')
  })
})

describe('buildSupplementaryTipsPrompt', () => {
  it('includes meal name, servings, ingredients, and the user preparation notes', () => {
    const result = buildSupplementaryTipsPrompt(supplementaryInput())

    expect(result).toContain('Meal: Chicken stir fry')
    expect(result).toContain('Servings: 4')
    expect(result).toContain('- Chicken breast: 600g')
    expect(result).toContain("User's preparation notes:")
    expect(result).toContain('Sear chicken first, then add vegetables.')
  })

  it('omits the locale instruction block for the default (English) locale', () => {
    const result = buildSupplementaryTipsPrompt(supplementaryInput({ locale: 'en' }))

    expect(result).not.toContain('LOCALE:')
  })

  it('injects the Estonian instruction when locale is "et"', () => {
    const result = buildSupplementaryTipsPrompt(supplementaryInput({ locale: 'et' }))

    expect(result).toContain('LOCALE:')
    expect(result).toContain('Estonian')
  })
})
