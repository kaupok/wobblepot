/**
 * Deploy identity for error and analytics capture.
 *
 * Deliberately dependency-free: `instrumentation.ts` imports this, and that
 * file must not pull `posthog-node` or the Zod env module into the edge
 * bundle. Reads `process.env` directly for the same reason.
 */

/** Release value standing in for "not a deployment" — a dev server or a test run. */
export const LOCAL_RELEASE = 'local'

/**
 * The deploy this process belongs to, for pivoting error tracking by release.
 *
 * `VERCEL_GIT_COMMIT_SHA` is a Vercel system env var present at runtime in
 * every deployed environment, preview and production alike. Its absence means
 * a local machine. Uses `||` rather than `??` so an empty-string SHA (a
 * misconfigured env var) reads as local rather than shipping `release: ''`.
 */
export function getRelease(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA || LOCAL_RELEASE
}

/**
 * True when capture should be skipped because this is a local machine.
 *
 * Local errors pollute the shared PostHog project and fire first-seen alerts,
 * which trains the team to ignore those alerts. Every server-side capture path
 * gates on this so the rule lives in one place.
 *
 * `POSTHOG_CAPTURE_LOCAL=1` opts a local machine back in. The capture pipeline
 * itself took six PRs (#581–#586) to get right, and the next person who has to
 * verify it end-to-end needs a way to actually send an event from a dev server.
 */
export function shouldSkipLocalCapture(): boolean {
  if (process.env.POSTHOG_CAPTURE_LOCAL === '1') return false
  return getRelease() === LOCAL_RELEASE
}
