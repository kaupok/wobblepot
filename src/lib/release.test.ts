import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_RELEASE, getRelease, shouldSkipLocalCapture } from './release'

describe('release', () => {
  beforeEach(() => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '')
    vi.stubEnv('POSTHOG_CAPTURE_LOCAL', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('getRelease', () => {
    it('returns the commit SHA when deployed', () => {
      vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'deadbeef')
      expect(getRelease()).toBe('deadbeef')
    })

    it('falls back to "local" when the SHA is unset', () => {
      expect(getRelease()).toBe(LOCAL_RELEASE)
    })

    it('treats an empty SHA as local rather than shipping an empty release', () => {
      vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '')
      expect(getRelease()).toBe(LOCAL_RELEASE)
    })
  })

  describe('shouldSkipLocalCapture', () => {
    it('skips on a local machine', () => {
      expect(shouldSkipLocalCapture()).toBe(true)
    })

    it('does not skip on a deployment', () => {
      vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'deadbeef')
      expect(shouldSkipLocalCapture()).toBe(false)
    })

    it('honours the POSTHOG_CAPTURE_LOCAL escape hatch', () => {
      vi.stubEnv('POSTHOG_CAPTURE_LOCAL', '1')
      expect(shouldSkipLocalCapture()).toBe(false)
    })

    it('ignores POSTHOG_CAPTURE_LOCAL values other than "1"', () => {
      vi.stubEnv('POSTHOG_CAPTURE_LOCAL', 'true')
      expect(shouldSkipLocalCapture()).toBe(true)
    })
  })
})
