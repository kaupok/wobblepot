// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// `ENABLED` is read once at module load, so each test sets the env, resets the
// module cache, and re-imports to exercise the enabled / disabled branch.
async function loadWith(value: string | undefined) {
  if (value === undefined) {
    delete process.env.SIGNUP_TIMING_LOG
  } else {
    process.env.SIGNUP_TIMING_LOG = value
  }
  vi.resetModules()
  return import('./signup-timing')
}

describe('timeSignupStep', () => {
  // stderr on purpose — see the module doc comment in signup-timing.ts.
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    delete process.env.SIGNUP_TIMING_LOG
  })

  it('returns the step result unchanged when enabled', async () => {
    const { timeSignupStep } = await loadWith('1')
    await expect(timeSignupStep('hibp', async () => 'ok')).resolves.toBe('ok')
  })

  it('logs a structured line with the step name when enabled', async () => {
    const { timeSignupStep } = await loadWith('1')
    await timeSignupStep('scrypt', async () => 'ok')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toMatch(/^\[signup-timing\] step=scrypt ms=\d+$/)
  })

  it('logs the duration even when the step throws, then rethrows', async () => {
    const { timeSignupStep } = await loadWith('true')
    const boom = new Error('boom')
    await expect(
      timeSignupStep('total', async () => {
        throw boom
      }),
    ).rejects.toBe(boom)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toMatch(/^\[signup-timing\] step=total ms=\d+$/)
  })

  it('does not log when disabled', async () => {
    const { timeSignupStep } = await loadWith(undefined)
    await expect(timeSignupStep('hibp', async () => 42)).resolves.toBe(42)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
