import { describe, it, expect } from 'vitest'
import { env, envSchema } from './env'

describe('Environment Validation', () => {
  describe('Success Cases', () => {
    it('should have NEXT_PUBLIC_APP_NAME defined', () => {
      expect(env.NEXT_PUBLIC_APP_NAME).toBeDefined()
      expect(typeof env.NEXT_PUBLIC_APP_NAME).toBe('string')
      expect(env.NEXT_PUBLIC_APP_NAME.length).toBeGreaterThan(0)
    })

    it('should allow optional NEXT_PUBLIC_APP_URL', () => {
      // URL should be either a string or undefined
      if (env.NEXT_PUBLIC_APP_URL !== undefined) {
        expect(typeof env.NEXT_PUBLIC_APP_URL).toBe('string')
      }
    })
  })

  describe('Validation Failures', () => {
    it('should reject missing NEXT_PUBLIC_APP_NAME', () => {
      const result = envSchema.safeParse({})
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.NEXT_PUBLIC_APP_NAME).toBeDefined()
      }
    })

    it('should reject empty NEXT_PUBLIC_APP_NAME', () => {
      const result = envSchema.safeParse({
        NEXT_PUBLIC_APP_NAME: '',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.NEXT_PUBLIC_APP_NAME).toBeDefined()
      }
    })

    it('should reject invalid URL format for NEXT_PUBLIC_APP_URL', () => {
      const result = envSchema.safeParse({
        NEXT_PUBLIC_APP_NAME: 'TestApp',
        NEXT_PUBLIC_APP_URL: 'not-a-valid-url',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.NEXT_PUBLIC_APP_URL).toBeDefined()
      }
    })

    it('should accept valid URL format for NEXT_PUBLIC_APP_URL', () => {
      const result = envSchema.safeParse({
        NEXT_PUBLIC_APP_NAME: 'TestApp',
        NEXT_PUBLIC_APP_URL: 'https://example.com',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.NEXT_PUBLIC_APP_URL).toBe('https://example.com')
      }
    })
  })
})
