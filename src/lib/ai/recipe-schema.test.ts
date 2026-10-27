import { describe, it, expect } from 'vitest'
import { buildRecipeExtractionSchema } from './recipe-schema'

describe('buildRecipeExtractionSchema', () => {
  it("names the household's size as the servings default, not a fixed 4 (HON-1363)", () => {
    const schema = buildRecipeExtractionSchema(2)
    expect(schema.shape.servings.description).toBe(
      'Number of servings the recipe makes (integer, 1-50, default to 2 if not specified)',
    )
  })
})
