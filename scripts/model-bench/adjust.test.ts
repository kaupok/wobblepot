// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { AdjustCase } from './case-schema'
import { scoreAdjust } from './adjust'

const input: AdjustCase = {
  mealName: 'Creamy mushroom pasta',
  servings: 4,
  components: [
    { name: 'pasta', quantityPerServing: 100, defaultUnit: 'g' },
    { name: 'double cream', quantityPerServing: 50, defaultUnit: 'ml' },
    { name: 'mushroom', quantityPerServing: 80, defaultUnit: 'g' },
  ],
  pantry: [],
  restrictions: { allergens: [], dietaryType: null, excludedIngredients: [], restrictions: [] },
  instruction: 'No cream, use yoghurt',
  locale: 'en',
  expected: {
    changes: [{ op: 'replace', original: ['double cream'], replacementAny: ['yoghurt'] }],
    forbiddenKeywords: ['cashew'],
  },
}

const change = (fields: Record<string, unknown>) => ({
  op: 'replace' as const,
  original: 'double cream',
  replacement: 'Greek yoghurt',
  quantityPerServing: 50,
  unit: 'g' as const,
  reason: 'You keep it creamy.',
  ...fields,
})

describe('scoreAdjust', () => {
  it('scores the steps flag against the case', () => {
    const stepsOnly = { ...input, expected: { noChange: true as const, followInSteps: true } }

    expect(scoreAdjust(stepsOnly, { changes: [], followInSteps: true }).stepsFlagged).toBe(1)
    expect(scoreAdjust(stepsOnly, { changes: [], followInSteps: false }).stepsFlagged).toBe(0)
  })

  it('passes the expected replace with an amount, a listed original and no forbidden food', () => {
    expect(scoreAdjust(input, { changes: [change({})], followInSteps: false })).toEqual({
      answered: 1,
      originalsResolve: 1,
      amountsGiven: 1,
      expectedChanges: 1,
      noChangeEmpty: null,
      stepsFlagged: null,
      avoidsForbidden: 1,
    })
  })

  it('fails an original the route would drop, a missing amount, and a forbidden replacement', () => {
    const scores = scoreAdjust(input, {
      changes: [change({ original: 'cream sauce', replacement: 'cashew cream', unit: null })],
      followInSteps: false,
    })

    expect(scores).toMatchObject({
      originalsResolve: 0,
      amountsGiven: 0,
      expectedChanges: 0,
      avoidsForbidden: 0,
    })
  })

  it('holds a no-change case to an empty list', () => {
    const noChange = { ...input, expected: { noChange: true as const } }

    expect(scoreAdjust(noChange, { changes: [], followInSteps: false })).toMatchObject({
      noChangeEmpty: 1,
      originalsResolve: null,
      amountsGiven: null,
    })
    expect(
      scoreAdjust(noChange, { changes: [change({})], followInSteps: false }).noChangeEmpty,
    ).toBe(0)
  })
})
