// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { RecipeCaseSchema } from './case-schema'

describe('RecipeCaseSchema', () => {
  const recipeCase = (lowConfidence: boolean) => ({
    text: 'Review: Harbour Kitchen. The beetroot soup was the highlight.',
    locale: 'en',
    expected: { ingredients: [], lowConfidence },
  })

  it('accepts a not-a-recipe case that expects no ingredients', () => {
    expect(RecipeCaseSchema.safeParse(recipeCase(true)).success).toBe(true)
  })

  it('rejects an empty ingredient list on a case the parser should accept', () => {
    const result = RecipeCaseSchema.safeParse(recipeCase(false))
    expect(result.success).toBe(false)
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ['expected', 'ingredients'],
        message: 'Only a lowConfidence case may expect no ingredients',
      }),
    ])
  })
})
