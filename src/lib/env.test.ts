import { describe, it, expect } from 'vitest'
import { clientEnv, clientEnvSchema, serverEnv, serverEnvSchema } from './env'

describe('Environment Validation', () => {
  describe('Client Environment', () => {
    it('should have NEXT_PUBLIC_APP_NAME defined', () => {
      expect(clientEnv.NEXT_PUBLIC_APP_NAME).toBeDefined()
      expect(typeof clientEnv.NEXT_PUBLIC_APP_NAME).toBe('string')
      expect(clientEnv.NEXT_PUBLIC_APP_NAME.length).toBeGreaterThan(0)
    })

    it('should have NEXT_PUBLIC_APP_ENV defined with valid value', () => {
      const validValues = ['dev', 'preview', 'staging', 'production', 'ci', 'test']
      expect(clientEnv.NEXT_PUBLIC_APP_ENV).toBeDefined()
      expect(validValues).toContain(clientEnv.NEXT_PUBLIC_APP_ENV)
    })

    it('should allow optional NEXT_PUBLIC_APP_URL', () => {
      // URL should be either a string or undefined
      if (clientEnv.NEXT_PUBLIC_APP_URL !== undefined) {
        expect(typeof clientEnv.NEXT_PUBLIC_APP_URL).toBe('string')
      }
    })

    it('should not include server-only variables', () => {
      // clientEnv should not have BETTER_AUTH_SECRET
      expect('BETTER_AUTH_SECRET' in clientEnv).toBe(false)
    })
  })

  describe('Client Schema Validation', () => {
    it('should reject missing NEXT_PUBLIC_APP_NAME', () => {
      const result = clientEnvSchema.safeParse({})
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.NEXT_PUBLIC_APP_NAME).toBeDefined()
      }
    })

    it('should reject empty NEXT_PUBLIC_APP_NAME', () => {
      const result = clientEnvSchema.safeParse({
        NEXT_PUBLIC_APP_NAME: '',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.NEXT_PUBLIC_APP_NAME).toBeDefined()
      }
    })

    it('should reject invalid URL format for NEXT_PUBLIC_APP_URL', () => {
      const result = clientEnvSchema.safeParse({
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
      const result = clientEnvSchema.safeParse({
        NEXT_PUBLIC_APP_NAME: 'TestApp',
        NEXT_PUBLIC_APP_ENV: 'test',
        NEXT_PUBLIC_APP_URL: 'https://example.com',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.NEXT_PUBLIC_APP_URL).toBe('https://example.com')
      }
    })

    it('should reject missing NEXT_PUBLIC_APP_ENV', () => {
      const result = clientEnvSchema.safeParse({
        NEXT_PUBLIC_APP_NAME: 'TestApp',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.NEXT_PUBLIC_APP_ENV).toBeDefined()
      }
    })

    it('should reject invalid NEXT_PUBLIC_APP_ENV value', () => {
      const result = clientEnvSchema.safeParse({
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
        const result = clientEnvSchema.safeParse({
          NEXT_PUBLIC_APP_NAME: 'TestApp',
          NEXT_PUBLIC_APP_ENV: envValue,
        })
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.NEXT_PUBLIC_APP_ENV).toBe(envValue)
        }
      })
    })
  })

  describe('Server Schema Validation', () => {
    it('should reject missing BETTER_AUTH_SECRET', () => {
      const result = serverEnvSchema.safeParse({
        NEXT_PUBLIC_APP_NAME: 'TestApp',
        NEXT_PUBLIC_APP_ENV: 'test',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.BETTER_AUTH_SECRET).toBeDefined()
      }
    })

    it('should reject BETTER_AUTH_SECRET shorter than 32 characters', () => {
      const result = serverEnvSchema.safeParse({
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
      const result = serverEnvSchema.safeParse({
        NEXT_PUBLIC_APP_NAME: 'TestApp',
        NEXT_PUBLIC_APP_ENV: 'test',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        DATABASE_URL_UNPOOLED: 'postgresql://user:pass@localhost:5432/db',
        ANTHROPIC_API_KEY: 'sk-ant-test-key',
      })
      expect(result.success).toBe(true)
    })

    it('should accept BETTER_AUTH_SECRET with more than 32 characters', () => {
      const result = serverEnvSchema.safeParse({
        NEXT_PUBLIC_APP_NAME: 'TestApp',
        NEXT_PUBLIC_APP_ENV: 'test',
        BETTER_AUTH_SECRET: 'a'.repeat(64),
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        DATABASE_URL_UNPOOLED: 'postgresql://user:pass@localhost:5432/db',
        ANTHROPIC_API_KEY: 'sk-ant-test-key',
      })
      expect(result.success).toBe(true)
    })

    it('should include all client variables', () => {
      const result = serverEnvSchema.safeParse({
        NEXT_PUBLIC_APP_NAME: 'TestApp',
        NEXT_PUBLIC_APP_ENV: 'test',
        NEXT_PUBLIC_APP_URL: 'https://example.com',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        DATABASE_URL_UNPOOLED: 'postgresql://user:pass@localhost:5432/db',
        ANTHROPIC_API_KEY: 'sk-ant-test-key',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.NEXT_PUBLIC_APP_NAME).toBe('TestApp')
        expect(result.data.NEXT_PUBLIC_APP_ENV).toBe('test')
        expect(result.data.NEXT_PUBLIC_APP_URL).toBe('https://example.com')
        expect(result.data.BETTER_AUTH_SECRET).toBe('a'.repeat(32))
      }
    })
  })

  describe('Lazy Validation (Runtime Access)', () => {
    it('should validate BETTER_AUTH_SECRET when accessed in tests', () => {
      // In test environment, BETTER_AUTH_SECRET is set in vitest.config.ts
      // This validates it works at runtime
      expect(() => {
        const secret = serverEnv.BETTER_AUTH_SECRET
        expect(secret).toBeDefined()
        expect(secret?.length).toBeGreaterThanOrEqual(32)
      }).not.toThrow()
    })

    it('should allow access to client vars without validation errors', () => {
      expect(() => {
        const name = serverEnv.NEXT_PUBLIC_APP_NAME
        expect(name).toBeDefined()
      }).not.toThrow()
    })
  })
})
