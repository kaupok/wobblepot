import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('isEmailConfigured', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns false when RESEND_API_KEY is not set', async () => {
    vi.doMock('@/lib/env', () => ({
      serverEnv: {
        RESEND_API_KEY: undefined,
        RESEND_FROM_EMAIL: 'test@example.com',
      },
    }))

    const { isEmailConfigured } = await import('./resend')
    expect(isEmailConfigured()).toBe(false)
  })

  it('returns false when RESEND_FROM_EMAIL is not set', async () => {
    vi.doMock('@/lib/env', () => ({
      serverEnv: {
        RESEND_API_KEY: 're_test_key',
        RESEND_FROM_EMAIL: undefined,
      },
    }))

    const { isEmailConfigured } = await import('./resend')
    expect(isEmailConfigured()).toBe(false)
  })

  it('returns false when both env vars are not set', async () => {
    vi.doMock('@/lib/env', () => ({
      serverEnv: {
        RESEND_API_KEY: undefined,
        RESEND_FROM_EMAIL: undefined,
      },
    }))

    const { isEmailConfigured } = await import('./resend')
    expect(isEmailConfigured()).toBe(false)
  })

  it('returns true when both env vars are set', async () => {
    vi.doMock('@/lib/env', () => ({
      serverEnv: {
        RESEND_API_KEY: 're_test_key',
        RESEND_FROM_EMAIL: 'test@example.com',
      },
    }))

    const { isEmailConfigured } = await import('./resend')
    expect(isEmailConfigured()).toBe(true)
  })
})
