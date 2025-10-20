import { describe, it, expect } from 'vitest'
import { env, envSchema } from './env'

describe('Environment Validation', () => {
  describe('Success Cases', () => {
    it('should have NEXT_PUBLIC_APP_NAME defined', () => {
      expect(env.NEXT_PUBLIC_APP_NAME).toBeDefined()
      expect(typeof env.NEXT_PUBLIC_APP_NAME).toBe('string')
      expect(env.NEXT_PUBLIC_APP_NAME.length).toBeGreaterThan(0)
    })

    it('should have NEXT_PUBLIC_APP_ENV defined with valid value', () => {
      const validValues = ['dev', 'preview', 'staging', 'production', 'ci', 'test']
      expect(env.NEXT_PUBLIC_APP_ENV).toBeDefined()
      expect(validValues).toContain(env.NEXT_PUBLIC_APP_ENV)
    })

    it('should have BETTER_AUTH_SECRET defined', () => {
      expect(env.BETTER_AUTH_SECRET).toBeDefined()
      expect(typeof env.BETTER_AUTH_SECRET).toBe('string')
      expect(env.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32)
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
        NEXT_PUBLIC_APP_ENV: 'test',
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
        NEXT_PUBLIC_APP_ENV: 'test',
        NEXT_PUBLIC_APP_URL: 'https://example.com',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.NEXT_PUBLIC_APP_URL).toBe('https://example.com')
      }
    })

    it('should reject missing NEXT_PUBLIC_APP_ENV', () => {
      const result = envSchema.safeParse({
        NEXT_PUBLIC_APP_NAME: 'TestApp',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.NEXT_PUBLIC_APP_ENV).toBeDefined()
      }
    })

    it('should reject invalid NEXT_PUBLIC_APP_ENV value', () => {
      const result = envSchema.safeParse({
        NEXT_PUBLIC_APP_NAME: 'TestApp',
        NEXT_PUBLIC_APP_ENV: 'invalid-env',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.NEXT_PUBLIC_APP_ENV).toBeDefined()
      }
    })

    it('should accept all valid NEXT_PUBLIC_APP_ENV values', () => {
      const validEnvs = ['dev', 'preview', 'staging', 'production', 'ci', 'test']
      validEnvs.forEach((envValue) => {
        const result = envSchema.safeParse({
          NEXT_PUBLIC_APP_NAME: 'TestApp',
          NEXT_PUBLIC_APP_ENV: envValue,
          BETTER_AUTH_SECRET: 'a'.repeat(32),
        })
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.NEXT_PUBLIC_APP_ENV).toBe(envValue)
        }
      })
    })

    it('should reject missing BETTER_AUTH_SECRET', () => {
      const result = envSchema.safeParse({
        NEXT_PUBLIC_APP_NAME: 'TestApp',
        NEXT_PUBLIC_APP_ENV: 'test',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.BETTER_AUTH_SECRET).toBeDefined()
      }
    })

    it('should reject BETTER_AUTH_SECRET shorter than 32 characters', () => {
      const result = envSchema.safeParse({
        NEXT_PUBLIC_APP_NAME: 'TestApp',
        NEXT_PUBLIC_APP_ENV: 'test',
        BETTER_AUTH_SECRET: 'too-short',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.BETTER_AUTH_SECRET).toBeDefined()
        expect(result.error.flatten().fieldErrors.BETTER_AUTH_SECRET?.[0]).toContain(
          'at least 32 characters',
        )
      }
    })

    it('should accept BETTER_AUTH_SECRET with exactly 32 characters', () => {
      const result = envSchema.safeParse({
        NEXT_PUBLIC_APP_NAME: 'TestApp',
        NEXT_PUBLIC_APP_ENV: 'test',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
      })
      expect(result.success).toBe(true)
    })

    it('should accept BETTER_AUTH_SECRET with more than 32 characters', () => {
      const result = envSchema.safeParse({
        NEXT_PUBLIC_APP_NAME: 'TestApp',
        NEXT_PUBLIC_APP_ENV: 'test',
        BETTER_AUTH_SECRET: 'a'.repeat(64),
      })
      expect(result.success).toBe(true)
    })
  })
})
