import { describe, it, expect } from 'vitest'
import { RecipeExtractionSchema } from './recipe-schema'

describe('RecipeExtractionSchema', () => {
  it('is a Zod schema', () => {
    expect(RecipeExtractionSchema).toBeDefined()
    expect(RecipeExtractionSchema.parse).toBeDefined()
  })
})
