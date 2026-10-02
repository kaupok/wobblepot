import 'server-only'
import { cache } from 'react'
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
 *    `(await getLoadedPostHog())?.isFeatureEnabled(key)` from a post-consent client surface
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

/**
 * How long one `getAllFlags` result is reused for the same distinct id inside a
 * warm function instance. A kill-switch flip reaches the bootstrap and the
 * anonymous reads within this window; see "Caching" in `docs/FEATURE_FLAGS.md`.
 */
export const FLAG_CACHE_TTL_MS = 30_000
const FLAG_CACHE_MAX_ENTRIES = 1000

type EvaluatedFlags = Record<FlagKey, boolean>

/**
 * In-isolate cache of `getAllFlags` evaluations, keyed by distinct id. It holds
 * the promise rather than the result, so callers that start while a request is
 * in flight share it: the layout and the page render concurrently, and neither
 * is guaranteed to start first. A failed evaluation deletes its entry, so a
 * PostHog outage is never cached and the next read retries.
 */
const flagCache = new Map<string, { promise: Promise<EvaluatedFlags | null>; expiresAt: number }>()

/** Empty the in-isolate flag cache. Tests only: the map outlives each test. */
export function resetFlagCacheForTests(): void {
  flagCache.clear()
}

/** Coerce PostHog's `boolean | string | undefined` flag value to our boolean default. */
function coerceFlag(key: FlagKey, value: boolean | string | undefined): boolean {
  if (value === true) return true
  if (value === false) return false
  // `undefined` (flag not configured in PostHog) or a string variant we
  // don't model — fall back to the safe default.
  return FLAG_DEFAULTS[key]
}

/**
 * Evaluate every known flag in one `getAllFlags` call, raced against the
 * 100ms timeout. Resolves to `null` on timeout, error, or unset environment;
 * the callers turn that into the per-flag defaults. Never throws.
 *
 * `getAllFlags` sends no `$feature_flag_called` event, so only reads that
 * should send none may use this: the bootstrap and the shared `'anonymous'` id.
 */
async function fetchAllFlags(distinctId: string): Promise<EvaluatedFlags | null> {
  const posthog = getPosthogServer()
  if (!posthog) return null

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
      return null
    }

    // posthog-node does not reject on a failed `/flags` request (5xx, network
    // error, quota limit): `getAllFlags` resolves `{}`. Treat that as a failure
    // too, so the defaults are not cached for the full TTL.
    if (!result || Object.keys(result).length === 0) return null

    return Object.fromEntries(
      FLAG_KEYS.map((key) => [key, coerceFlag(key, result[key])]),
    ) as EvaluatedFlags
  } catch (error) {
    console.warn('[feature-flags] bootstrap error', { error })
    return null
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
  }
}

/**
 * `fetchAllFlags` behind two caches: React `cache()` for one evaluation per
 * request, and `flagCache` for one per distinct id per `FLAG_CACHE_TTL_MS`
 * across requests. Outside a React render (route handlers, Better Auth hooks)
 * `cache()` does not memoize, and `flagCache` alone dedupes.
 */
const evaluateAllFlags = cache(async (distinctId: string): Promise<EvaluatedFlags | null> => {
  const now = Date.now()
  const cached = flagCache.get(distinctId)
  if (cached && cached.expiresAt > now) return cached.promise

  if (flagCache.size >= FLAG_CACHE_MAX_ENTRIES) flagCache.clear()

  const promise = fetchAllFlags(distinctId)
  const entry = { promise, expiresAt: now + FLAG_CACHE_TTL_MS }
  flagCache.set(distinctId, entry)
  const result = await promise
  // Only drop our own entry: a later caller may have replaced it already.
  if (result === null && flagCache.get(distinctId) === entry) flagCache.delete(distinctId)
  return result
})

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

  // The shared `'anonymous'` id reads the same cached evaluation as the layout
  // bootstrap, so a landing or sign-up render makes one `/flags` request, not
  // two. `getAllFlags` also sends no `$feature_flag_called`: every anonymous
  // render (mostly crawlers) piled events onto one person and told us nothing.
  if (distinctId === 'anonymous') {
    const flags = await evaluateAllFlags(distinctId)
    return flags ? flags[key] : FLAG_DEFAULTS[key]
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(TIMEOUT_SENTINEL), FLAG_TIMEOUT_MS)
  })

  // Promise.race does not cancel the loser. Attach a .catch up front so a
  // late rejection from posthog-node (PostHog 5xx, network error, SDK's own
  // 10s timeout) doesn't bubble out as an `unhandledRejection` after the
  // race already resolved with our default.
  // User-id reads stay uncached and keep their `$feature_flag_called` event,
  // which is what PostHog uses to show a flag as active.
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
 * call to PostHog, for the client SDK's bootstrap. Cached per request and for
 * `FLAG_CACHE_TTL_MS` per distinct id, and shared with anonymous
 * `getServerFlag` reads, so a render that bootstraps and reads a flag makes one
 * `/flags` request.
 *
 * Same fail-open semantics as `getServerFlag` — timeout, error, or unset
 * environment all return the per-flag defaults.
 */
export async function bootstrapFlags(distinctId: string): Promise<BootstrapData> {
  const distinctIDForBootstrap = distinctId === 'anonymous' ? undefined : distinctId
  const flags = await evaluateAllFlags(distinctId)
  return {
    distinctID: distinctIDForBootstrap,
    featureFlags: flags ? { ...flags } : { ...FLAG_DEFAULTS },
  }
}
