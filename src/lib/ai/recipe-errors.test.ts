import { describe, it, expect } from 'vitest'
import { RecipeParseError } from './recipe-errors'

describe('RecipeParseError', () => {
  it('creates error with correct name and message', () => {
    const error = new RecipeParseError('Test error')
    expect(error.name).toBe('RecipeParseError')
    expect(error.message).toBe('Test error')
    expect(error).toBeInstanceOf(Error)
  })
})
