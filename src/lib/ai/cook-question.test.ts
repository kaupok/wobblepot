import { describe, it, expect } from 'vitest'
import {
  buildCookQuestionPrompt,
  buildCookQuestionRequest,
  type CookQuestionRequestInput,
} from './cook-question'
import { estonianVoiceForPrepTips, localeInstruction } from './prompts'

function input(overrides: Partial<CookQuestionRequestInput> = {}): CookQuestionRequestInput {
  return {
    mealName: 'Creamy chicken pasta',
    servings: 4,
    timeMinutes: 30,
    components: [
      { name: 'chicken breast', quantityPerServing: 150, defaultUnit: 'g' },
      { name: 'cream', quantityPerServing: 50, defaultUnit: 'ml' },
    ],
    preparationNotes: null,
    steps: ['Boil the pasta.', 'Brown the chicken.', 'Stir in the cream.'],
    stepIndex: 2,
    pitfalls: [],
    tip: null,
    pantry: [
      { name: 'greek yoghurt', isStaple: false },
      { name: 'olive oil', isStaple: true },
    ],
    restrictions: { allergens: [], dietaryType: null, excludedIngredients: [], restrictions: [] },
    question: 'What can I substitute here?',
    locale: 'en',
    ...overrides,
  }
}

/** The text of one prompt section: from its heading to the next blank line. */
function section(prompt: string, heading: string): string {
  const start = prompt.indexOf(heading)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = prompt.indexOf('\n\n', start)
  return prompt.slice(start, end === -1 ? undefined : end)
}

describe('buildCookQuestionPrompt', () => {
  it('names the pantry items, staples marked, in the pantry section', () => {
    const pantry = section(buildCookQuestionPrompt(input()), 'PANTRY')
    expect(pantry).toContain('- greek yoghurt\n')
    expect(pantry).toContain('- olive oil (staple)')
  })

  it('says the pantry is empty rather than leaving the section blank', () => {
    const pantry = section(buildCookQuestionPrompt(input({ pantry: [] })), 'PANTRY')
    expect(pantry).toContain('recorded nothing')
  })

  it('puts a nut allergy in the restrictions section and the pantry in the pantry section', () => {
    const prompt = buildCookQuestionPrompt(
      input({
        restrictions: {
          allergens: ['tree_nuts'],
          dietaryType: 'vegetarian',
          excludedIngredients: ['coriander'],
          restrictions: ['mild spice only'],
        },
      }),
    )
    const restrictions = section(prompt, 'HOUSEHOLD RESTRICTIONS')
    expect(restrictions).toContain('MUST AVOID these allergens (safety-critical): tree_nuts')
    expect(restrictions).toContain('Dietary type: vegetarian')
    expect(restrictions).toContain('Excluded ingredients (do not use): coriander')
    expect(restrictions).toContain('Household restrictions (follow them): mild spice only')
    expect(restrictions).not.toContain('greek yoghurt')
    // HON-896: restrictions, never preferences.
    expect(prompt.toLowerCase()).not.toContain('preference')
    expect(section(prompt, 'PANTRY')).toContain('greek yoghurt')
    expect(section(prompt, 'PANTRY')).not.toContain('tree_nuts')
  })

  it('tells the model to call only pantry ingredients available', () => {
    expect(buildCookQuestionPrompt(input())).toContain(
      'Only call an ingredient available if it is in the pantry.',
    )
  })

  it('numbers the steps and marks the asked step', () => {
    const prompt = buildCookQuestionPrompt(input())
    expect(prompt).toContain('1. Boil the pasta.\n2. Brown the chicken.\n3. Stir in the cream.')
    expect(prompt).toContain('The cook is on step 3: Stir in the cream.')
  })

  it('scales the ingredients to the servings', () => {
    expect(buildCookQuestionPrompt(input())).toContain('- chicken breast: 600g')
  })

  it('includes the cached pitfalls and tip when given, and leaves them out otherwise', () => {
    const withTips = buildCookQuestionPrompt(
      input({ pitfalls: ['Do not boil the cream'], tip: 'Rest the chicken' }),
    )
    expect(withTips).toContain('Watch out:\n- Do not boil the cream')
    expect(withTips).toContain('Tip: Rest the chicken')

    const without = buildCookQuestionPrompt(input())
    expect(without).not.toContain('Watch out:')
    expect(without).not.toContain('Tip:')
  })

  it('includes the household notes when present', () => {
    expect(buildCookQuestionPrompt(input({ preparationNotes: 'Add chili' }))).toContain(
      "The household's own notes on this meal:\nAdd chili",
    )
  })

  it('fences the question', () => {
    expect(buildCookQuestionPrompt(input())).toContain('<<<\nWhat can I substitute here?\n>>>')
  })

  it('ends with the locale instruction and the Estonian voice for an Estonian household', () => {
    const prompt = buildCookQuestionPrompt(input({ locale: 'et' }))
    expect(prompt.endsWith(localeInstruction('et') + estonianVoiceForPrepTips('et'))).toBe(true)
    expect(localeInstruction('et')).toContain('LOCALE:')
  })

  it('adds no locale block for English', () => {
    expect(buildCookQuestionPrompt(input())).not.toContain('LOCALE:')
  })
})

describe('buildCookQuestionRequest', () => {
  it('sends plain text, no schema, with the agreed ceilings', () => {
    const request = buildCookQuestionRequest(input())
    expect(request).not.toHaveProperty('schema')
    expect(request.maxOutputTokens).toBe(600)
    expect(request.maxRetries).toBe(3)
    expect(request.prompt).toBe(buildCookQuestionPrompt(input()))
  })
})
