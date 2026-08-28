import 'server-only'

/**
 * Per-step timing for the sign-up request path (HON-569).
 *
 * The local E2E suite loses about a quarter of its auth runs to sign-up
 * timeouts. The latency is spread across a feature-flag read, a 2s HIBP call
 * plus CPU-bound scrypt, and cold Neon round trips — but the project had no
 * timing on that path, so the split was guessed. Each instrumented step logs
 * one structured line (`[signup-timing] step=<name> ms=<n>`), so a run can be
 * grepped into a per-step breakdown and the fix (or a timeout bump) can be
 * decided from data.
 *
 * Off by default so production sign-ups stay quiet. Set `SIGNUP_TIMING_LOG=1`
 * (or `true`) to enable — the local E2E runner sets it. Read directly from
 * `process.env`, mirroring `E2E_DISABLE_RATE_LIMIT` in `src/lib/rate-limit.ts`.
 */
const ENABLED = process.env.SIGNUP_TIMING_LOG === '1' || process.env.SIGNUP_TIMING_LOG === 'true'

/**
 * Time an async step and log its duration when timing is enabled. Returns the
 * step result unchanged, so it wraps a call transparently. When disabled it
 * calls through with no timing overhead. The duration is logged even when the
 * step throws, so a rejected HIBP or DB call still reports its latency.
 */
export async function timeSignupStep<T>(step: string, fn: () => Promise<T>): Promise<T> {
  if (!ENABLED) return fn()

  const start = performance.now()
  try {
    return await fn()
  } finally {
    const ms = Math.round(performance.now() - start)
    // eslint-disable-next-line no-console
    console.info(`[signup-timing] step=${step} ms=${ms}`)
  }
}
