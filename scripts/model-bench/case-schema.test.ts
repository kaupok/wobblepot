// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { CASE_SCHEMAS, RecipeCaseSchema, TASKS } from './case-schema'
import { loadCases } from './load-cases'

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

describe('every case schema', () => {
  const cases = loadCases(TASKS)

  it.each(TASKS)('%s accepts a source and rejects an unknown top-level key', (task) => {
    const input = cases.find((c) => c.task === task)!.input
    const schema = CASE_SCHEMAS[task]

    expect(schema.safeParse({ ...input, source: 'HON-895' }).success).toBe(true)

    // A renamed draft that still carries its production sample must not load.
    const leftover = schema.safeParse({ ...input, sampleOutput: { meals: [] } })
    expect(leftover.success).toBe(false)
    expect(leftover.error?.issues[0]).toMatchObject({
      code: 'unrecognized_keys',
      keys: ['sampleOutput'],
    })
  })

  it('tags the cases the HON-895 and HON-896 incidents named', () => {
    const sources = Object.fromEntries(
      cases.flatMap((c) => ('source' in c.input && c.input.source ? [[c.id, c.input.source]] : [])),
    )
    expect(sources).toMatchObject({
      'imagine/en-nut-allergy-noodles': 'HON-896',
      'imagine/en-shellfish-allergy-paella': 'HON-895',
      'imagine/et-fish-allergy-sushi': 'HON-895',
      'imagine/et-vegan-sour-cream': 'HON-895',
    })
  })
})
