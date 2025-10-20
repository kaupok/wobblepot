import { describe, it, expect } from 'vitest'
import { env } from './env'

describe('Environment Validation', () => {
  it('should have NEXT_PUBLIC_APP_NAME defined', () => {
    expect(env.NEXT_PUBLIC_APP_NAME).toBeDefined()
    expect(typeof env.NEXT_PUBLIC_APP_NAME).toBe('string')
  })

  it('should have proper typing for env object', () => {
    // Verify that env has expected properties
    expect(Object.prototype.hasOwnProperty.call(env, 'NEXT_PUBLIC_APP_NAME')).toBe(true)
  })

  it('should allow optional NEXT_PUBLIC_APP_URL', () => {
    // URL should be either a string or undefined
    if (env.NEXT_PUBLIC_APP_URL !== undefined) {
      expect(typeof env.NEXT_PUBLIC_APP_URL).toBe('string')
    }
  })
})
