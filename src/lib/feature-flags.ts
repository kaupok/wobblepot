import 'server-only'
import { getPosthogServer } from '@/lib/posthog-server'

/**
 * Typed feature flag keys. Adding a new flag is a four-step process:
 *
 * 1. Add the key here.
 * 2. Add a default in `FLAG_DEFAULTS` (must be the safe value — see "Fail-open
 *    on PostHog outage" in `docs/FEATURE_FLAGS.md`).
 * 3. Create the flag in all three PostHog projects (`mealplan-production` /
 *    `mealplan-staging` / `mealplan-development`) with the same default.
 * 4. Read it via `getServerFlag(key, distinctId)` from server code, or via
 *    `usePostHog().isFeatureEnabled(key)` from a post-consent client surface
 *    (bootstrap is wired in `layout.tsx` so client reads are flicker-free).
 */
export type FlagKey = 'ai_generation_enabled' | 'recipe_import_enabled' | 'invite_code_required'

/**
 * Default returned when PostHog is unreachable, slow, or has no value for the
 * flag. Every kill-switch defaults to the safe value so a PostHog outage cannot
 * itself disable the product or open unintended surface area.
 */
export const FLAG_DEFAULTS: Record<FlagKey, boolean> = {
  ai_generation_enabled: true,
  recipe_import_enabled: true,
  invite_code_required: true,
}

const FLAG_KEYS = Object.keys(FLAG_DEFAULTS) as FlagKey[]

/**
 * Bootstrap payload passed from server to client so `posthog.isFeatureEnabled`
 * returns the correct value synchronously on first render — no flash of wrong
 * variant during hydration. Shape matches PostHog's `BootstrapConfig` subset
 * we care about.
 */
export interface BootstrapData {
  distinctID: string
  featureFlags: Record<FlagKey, boolean>
}

const FLAG_TIMEOUT_MS = 100
const TIMEOUT_SENTINEL = Symbol('feature-flag-timeout')

/**
 * Read a feature flag from the server. Returns the flag's default
 * (`FLAG_DEFAULTS[key]`) when PostHog is unconfigured, slow (>100ms), or
 * errors out. Never throws.
 *
 * Logs to `console.warn` on timeout / error rather than capturing into
 * PostHog itself — the very scenario this guards against is PostHog being
 * unavailable, so error-capturing would storm during an outage.
 */
export async function getServerFlag(key: FlagKey, distinctId: string): Promise<boolean> {
  const posthog = getPosthogServer()
  if (!posthog) return FLAG_DEFAULTS[key]

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(TIMEOUT_SENTINEL), FLAG_TIMEOUT_MS)
  })

  try {
    const result = await Promise.race([posthog.getFeatureFlag(key, distinctId), timeoutPromise])

    if (result === TIMEOUT_SENTINEL) {
      console.warn('[feature-flags] timeout', { key })
      return FLAG_DEFAULTS[key]
    }

    if (result === true) return true
    if (result === false) return false
    // `undefined` (flag not configured in PostHog) or a string variant we
    // don't model — fall back to the safe default.
    return FLAG_DEFAULTS[key]
  } catch (error) {
    console.warn('[feature-flags] error', { key, error })
    return FLAG_DEFAULTS[key]
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
  }
}

/**
 * Evaluate every known flag for the given distinct id, returning a
 * `BootstrapData` ready to pass through React props to `PostHogProvider`.
 *
 * Each flag is evaluated in parallel with the same fail-open semantics as
 * `getServerFlag` — one slow / failing flag does not affect the others.
 */
export async function bootstrapFlags(distinctId: string): Promise<BootstrapData> {
  const entries = await Promise.all(
    FLAG_KEYS.map(async (key) => [key, await getServerFlag(key, distinctId)] as const),
  )
  return {
    distinctID: distinctId,
    featureFlags: Object.fromEntries(entries) as Record<FlagKey, boolean>,
  }
}
