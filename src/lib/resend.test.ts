import { describe, it, expect, vi, beforeEach } from 'vitest'

// The Resend client is cached on globalThis to survive Next.js HMR. That cache
// outlives `vi.resetModules()`, so without an explicit clear, a test that
// configures an API key would leak its truthy client into the next test and
// silently mask later failures (e.g., a "becomes unconfigured" assertion).
function clearResendSingleton() {
  delete (globalThis as { resend?: unknown }).resend
}

describe('isEmailConfigured', () => {
  beforeEach(() => {
    vi.resetModules()
    clearResendSingleton()
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

  // Regression for the globalThis-cached singleton: without clearResendSingleton
  // in beforeEach, a prior "configured" test would leak its truthy client into
  // this run and incorrectly report `true`.
  it('returns false when RESEND_API_KEY is unset after a previous configured run', async () => {
    vi.doMock('@/lib/env', () => ({
      clientEnv: { NEXT_PUBLIC_APP_ENV: 'production' },
      serverEnv: { RESEND_API_KEY: 're_test_key' },
    }))
    await import('./resend')

    vi.resetModules()
    clearResendSingleton()
    vi.doMock('@/lib/env', () => ({
      clientEnv: { NEXT_PUBLIC_APP_ENV: 'production' },
      serverEnv: { RESEND_API_KEY: undefined },
    }))

    const { isEmailConfigured } = await import('./resend')
    expect(isEmailConfigured()).toBe(false)
  })
})

describe('envSubject', () => {
  beforeEach(() => {
    vi.resetModules()
    clearResendSingleton()
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
