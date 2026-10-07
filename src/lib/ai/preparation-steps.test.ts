import { describe, it, expect } from 'vitest'
import {
  buildFullStepsPrompt,
  buildSupplementaryStepsPrompt,
  formatIngredientsList,
  type PrepStepsPromptInput,
  type SupplementaryPrepStepsPromptInput,
} from './preparation-steps'
import { estonianVoiceForPrepSteps, englishVoiceForPrepSteps } from './prompts'

function fullInput(overrides: Partial<PrepStepsPromptInput> = {}): PrepStepsPromptInput {
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
  overrides: Partial<SupplementaryPrepStepsPromptInput> = {},
): SupplementaryPrepStepsPromptInput {
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

describe('buildFullStepsPrompt', () => {
  it('includes meal name, servings, and ingredients', () => {
    const result = buildFullStepsPrompt(fullInput())

    expect(result).toContain('Meal: Chicken stir fry')
    expect(result).toContain('Servings: 4')
    expect(result).toContain('Time budget: 30 minutes')
    expect(result).toContain('- Chicken breast: 600g')
  })

  it('omits the time-budget line when timeMinutes is null', () => {
    const result = buildFullStepsPrompt(fullInput({ timeMinutes: null }))

    expect(result).not.toContain('Time budget')
  })

  it('does not reference user preparation notes', () => {
    const result = buildFullStepsPrompt(fullInput())

    expect(result).not.toContain("User's preparation notes")
  })

  it('omits the locale instruction block for the default (English) locale', () => {
    const result = buildFullStepsPrompt(fullInput({ locale: 'en' }))

    expect(result).not.toContain('LOCALE:')
  })

  it('injects the Estonian instruction when locale is "et"', () => {
    const result = buildFullStepsPrompt(fullInput({ locale: 'et' }))

    expect(result).toContain('LOCALE:')
    expect(result).toContain('Estonian')
  })

  it('appends the Estonian voice block after the locale instruction for "et" only', () => {
    const et = buildFullStepsPrompt(fullInput({ locale: 'et' }))
    expect(et).toContain('ESTONIAN VOICE')
    expect(et).toContain('Kuumuta ahi')
    expect(et.indexOf('LOCALE:')).toBeLessThan(et.indexOf('ESTONIAN VOICE'))

    expect(buildFullStepsPrompt(fullInput({ locale: 'en' }))).not.toContain('ESTONIAN VOICE')
  })

  it('appends the English voice block for "en" only (HON-963)', () => {
    const en = buildFullStepsPrompt(fullInput({ locale: 'en' }))
    expect(en).toContain('ENGLISH VOICE')
    expect(en.endsWith(englishVoiceForPrepSteps('en'))).toBe(true)

    expect(buildFullStepsPrompt(fullInput({ locale: 'et' }))).not.toContain('ENGLISH VOICE')
  })

  it('leaves the Estonian prompt ending on the Estonian voice block', () => {
    const et = buildFullStepsPrompt(fullInput({ locale: 'et' }))
    expect(et.endsWith(estonianVoiceForPrepSteps('et'))).toBe(true)
  })
})

describe('buildSupplementaryStepsPrompt', () => {
  it('includes meal name, servings, ingredients, and the user preparation notes', () => {
    const result = buildSupplementaryStepsPrompt(supplementaryInput())

    expect(result).toContain('Meal: Chicken stir fry')
    expect(result).toContain('Servings: 4')
    expect(result).toContain('- Chicken breast: 600g')
    expect(result).toContain("User's preparation notes:")
    expect(result).toContain('Sear chicken first, then add vegetables.')
  })

  it('omits the locale instruction block for the default (English) locale', () => {
    const result = buildSupplementaryStepsPrompt(supplementaryInput({ locale: 'en' }))

    expect(result).not.toContain('LOCALE:')
  })

  it('injects the Estonian instruction when locale is "et"', () => {
    const result = buildSupplementaryStepsPrompt(supplementaryInput({ locale: 'et' }))

    expect(result).toContain('LOCALE:')
    expect(result).toContain('Estonian')
  })

  it('appends the Estonian voice block after the locale instruction for "et" only', () => {
    const et = buildSupplementaryStepsPrompt(supplementaryInput({ locale: 'et' }))
    expect(et).toContain('ESTONIAN VOICE')
    expect(et).toContain('Kuumuta ahi')
    expect(et.indexOf('LOCALE:')).toBeLessThan(et.indexOf('ESTONIAN VOICE'))

    expect(buildSupplementaryStepsPrompt(supplementaryInput({ locale: 'en' }))).not.toContain(
      'ESTONIAN VOICE',
    )
  })

  it('appends the English voice block for "en" only (HON-963)', () => {
    const en = buildSupplementaryStepsPrompt(supplementaryInput({ locale: 'en' }))
    expect(en).toContain('ENGLISH VOICE')
    expect(en.endsWith(englishVoiceForPrepSteps('en'))).toBe(true)

    const et = buildSupplementaryStepsPrompt(supplementaryInput({ locale: 'et' }))
    expect(et).not.toContain('ENGLISH VOICE')
    expect(et.endsWith(estonianVoiceForPrepSteps('et'))).toBe(true)
  })
})

describe('formatIngredientsList', () => {
  it('sends a liquid the cook measures by volume in ml, 1 g = 1 ml (HON-1070)', () => {
    expect(
      formatIngredientsList(
        [{ name: 'red wine', quantityPerServing: 30, defaultUnit: 'g', measuredByVolume: true }],
        4,
      ),
    ).toBe('- red wine: 120ml')
  })

  it('keeps grams for an unflagged ingredient and for an absent flag', () => {
    expect(
      formatIngredientsList(
        [
          { name: 'flour', quantityPerServing: 30, defaultUnit: 'g', measuredByVolume: false },
          { name: 'rice', quantityPerServing: 75, defaultUnit: 'g' },
        ],
        2,
      ),
    ).toBe('- flour: 60g\n- rice: 150g')
  })

  it('shows pieces as pcs, flagged or not', () => {
    expect(
      formatIngredientsList(
        [{ name: 'egg', quantityPerServing: 1, defaultUnit: 'piece', measuredByVolume: true }],
        2,
      ),
    ).toBe('- egg: 2pcs')
  })

  it('passes through a unit storage does not have, as the eval cases write ml', () => {
    expect(
      formatIngredientsList([{ name: 'soy sauce', quantityPerServing: 15, defaultUnit: 'ml' }], 2),
    ).toBe('- soy sauce: 30ml')
  })
})
