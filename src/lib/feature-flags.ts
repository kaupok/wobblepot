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
 *
 * `distinctID` is optional: omit it for anonymous visitors so PostHog generates
 * its own client-side UUID. Sharing the literal string `'anonymous'` across
 * every logged-out visitor breaks anonymous-funnel attribution and any future
 * percentage-rollout flag for unauthenticated users. Server-side flag reads
 * still pass `'anonymous'` (kill-switches don't depend on per-user hashing).
 */
export interface BootstrapData {
  distinctID?: string
  featureFlags: Record<FlagKey, boolean>
}

const FLAG_TIMEOUT_MS = 100
const TIMEOUT_SENTINEL = Symbol('feature-flag-timeout')

/** Coerce PostHog's `boolean | string | undefined` flag value to our boolean default. */
function coerceFlag(key: FlagKey, value: boolean | string | undefined): boolean {
  if (value === true) return true
  if (value === false) return false
  // `undefined` (flag not configured in PostHog) or a string variant we
  // don't model — fall back to the safe default.
  return FLAG_DEFAULTS[key]
}

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

  // Promise.race does not cancel the loser. Attach a .catch up front so a
  // late rejection from posthog-node (PostHog 5xx, network error, SDK's own
  // 10s timeout) doesn't bubble out as an `unhandledRejection` after the
  // race already resolved with our default.
  const flagPromise = posthog.getFeatureFlag(key, distinctId).catch((error) => {
    console.warn('[feature-flags] late error', { key, error })
    return undefined as boolean | string | undefined
  })

  try {
    const result = await Promise.race([flagPromise, timeoutPromise])

    if (result === TIMEOUT_SENTINEL) {
      console.warn('[feature-flags] timeout', { key })
      return FLAG_DEFAULTS[key]
    }

    return coerceFlag(key, result)
  } catch (error) {
    console.warn('[feature-flags] error', { key, error })
    return FLAG_DEFAULTS[key]
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
  }
}

/**
 * Evaluate every known flag for the given distinct id in a single batched
 * call to PostHog. Without `personalApiKey` configured on the server SDK,
 * `getFeatureFlag` per-call hits the `/decide` endpoint; using `getAllFlags`
 * collapses N round-trips and N `$feature_flag_called` events into one.
 *
 * Same fail-open semantics as `getServerFlag` — timeout, error, or unset
 * environment all return the per-flag defaults.
 */
export async function bootstrapFlags(distinctId: string): Promise<BootstrapData> {
  const distinctIDForBootstrap = distinctId === 'anonymous' ? undefined : distinctId
  const safeDefaults = (): BootstrapData => ({
    distinctID: distinctIDForBootstrap,
    featureFlags: { ...FLAG_DEFAULTS },
  })

  const posthog = getPosthogServer()
  if (!posthog) return safeDefaults()

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(TIMEOUT_SENTINEL), FLAG_TIMEOUT_MS)
  })

  // Same late-rejection guard as getServerFlag — Promise.race doesn't cancel.
  const allFlagsPromise = posthog.getAllFlags(distinctId).catch((error) => {
    console.warn('[feature-flags] bootstrap late error', { error })
    return undefined as Record<string, boolean | string> | undefined
  })

  try {
    const result = await Promise.race([allFlagsPromise, timeoutPromise])

    if (result === TIMEOUT_SENTINEL) {
      console.warn('[feature-flags] bootstrap timeout')
      return safeDefaults()
    }

    if (!result) return safeDefaults()

    const featureFlags = Object.fromEntries(
      FLAG_KEYS.map((key) => [key, coerceFlag(key, result[key])]),
    ) as Record<FlagKey, boolean>

    return { distinctID: distinctIDForBootstrap, featureFlags }
  } catch (error) {
    console.warn('[feature-flags] bootstrap error', { error })
    return safeDefaults()
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
  }
}
