import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('isEmailConfigured', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns false when RESEND_API_KEY is not set', async () => {
    vi.doMock('@/lib/env', () => ({
      clientEnv: { NEXT_PUBLIC_APP_ENV: 'production' },
      serverEnv: { RESEND_API_KEY: undefined },
    }))

    const { isEmailConfigured } = await import('./resend')
    expect(isEmailConfigured()).toBe(false)
  })

  it('returns true when RESEND_API_KEY is set', async () => {
    vi.doMock('@/lib/env', () => ({
      clientEnv: { NEXT_PUBLIC_APP_ENV: 'production' },
      serverEnv: { RESEND_API_KEY: 're_test_key' },
    }))

    const { isEmailConfigured } = await import('./resend')
    expect(isEmailConfigured()).toBe(true)
  })
})

describe('envSubject', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('does not prefix in production', async () => {
    vi.doMock('@/lib/env', () => ({
      clientEnv: { NEXT_PUBLIC_APP_ENV: 'production' },
      serverEnv: { RESEND_API_KEY: 're_test_key' },
    }))

    const { envSubject } = await import('./resend')
    expect(envSubject('Reset your password')).toBe('Reset your password')
  })

  it.each(['staging', 'preview', 'dev', 'ci', 'test'] as const)(
    'prefixes [Staging] in %s env',
    async (env) => {
      vi.doMock('@/lib/env', () => ({
        clientEnv: { NEXT_PUBLIC_APP_ENV: env },
        serverEnv: { RESEND_API_KEY: 're_test_key' },
      }))

      const { envSubject } = await import('./resend')
      expect(envSubject('Reset your password')).toBe('[Staging] Reset your password')
    },
  )
})
