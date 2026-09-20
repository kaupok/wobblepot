/**
 * Does this error mean one of our AI wall-clock budgets fired?
 *
 * Extracted rather than hand-written per route, unlike the budgets themselves:
 * the budget is a different number at every call site and deserves its own
 * comment, but *how an abort surfaces* is one fact about `ai@7` that is
 * identical everywhere — and getting it wrong is silent, because the route
 * simply falls through to its generic 500.
 *
 * Two names, because the SDK surfaces the same abort differently depending on
 * what it was doing when the signal fired:
 *
 * - `TimeoutError` — the signal interrupted the HTTP request itself.
 *   `AbortSignal.timeout()` aborts with this name and
 *   `@ai-sdk/provider-utils`' `isAbortError` rethrows it untouched.
 * - `AbortError` — the signal fired while the SDK was *sleeping between
 *   retries*. `retryWithExponentialBackoffInternal` awaits
 *   `delay(ms, { abortSignal })` from inside its own `catch`, and that rejects
 *   with `DOMException('Delay was aborted', 'AbortError')`. Nothing re-wraps
 *   it, so the name that reaches the route is `AbortError`, not the
 *   `TimeoutError` the signal was created with.
 *
 * That second window is reachable in practice: `getRetryDelayInMs` honours
 * Anthropic's `retry-after` header for any value under 60s, so a 429 with
 * `retry-after: 30` parks the SDK in a sleep long enough for every budget in
 * this app to expire inside it.
 *
 * Treating `AbortError` as our own timeout is safe here because none of these
 * call sites threads the incoming `Request`'s signal into `generateObject` —
 * the route's own budget is the only abort source on the path.
 *
 * The name is read structurally rather than behind an `instanceof Error`
 * guard. Both of these arrive as a `DOMException`, and `DOMException` only
 * inherits from the `Error` of its own realm: it does in Node, so the guard
 * happens to hold in production, but it is false under the jsdom environment
 * the unit tests run in — so an `instanceof` check here would be untestable
 * for the exact values it exists to match.
 */
export function isAiBudgetTimeout(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const name = (error as { name?: unknown }).name
  return name === 'TimeoutError' || name === 'AbortError'
}
