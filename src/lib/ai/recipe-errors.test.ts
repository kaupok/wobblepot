import { describe, it, expect } from 'vitest'
import { RecipeParseError } from './recipe-errors'

describe('RecipeParseError', () => {
  it('creates error with correct name and message', () => {
    const error = new RecipeParseError('Test error')
    expect(error.name).toBe('RecipeParseError')
    expect(error.message).toBe('Test error')
    expect(error).toBeInstanceOf(Error)
  })

  it('defaults the code to parse_failed', () => {
    expect(new RecipeParseError('Test error').code).toBe('parse_failed')
  })

  it('keeps the underlying error as cause for the route to report (HON-723)', () => {
    const upstream = new Error('Overloaded')
    const error = new RecipeParseError('Unavailable', 'provider_unavailable', { cause: upstream })
    expect(error.code).toBe('provider_unavailable')
    expect(error.cause).toBe(upstream)
  })
})
