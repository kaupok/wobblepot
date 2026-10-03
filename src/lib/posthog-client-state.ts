import type { PostHog } from 'posthog-js'

/**
 * Whether this document has run `posthog.init`. The two init paths
 * (`PostHogProvider` after consent, and the crash page in
 * `src/app/global-error.tsx`) set it. Without consent neither runs, so the
 * flag stays false and callers skip the `posthog-js` chunk download entirely
 * (HON-999).
 *
 * The `posthog-js` import is type-only, so this module does not pull the SDK
 * into the bundle.
 */
let loaded = false

export function markPostHogLoaded(): void {
  loaded = true
}

export function isPostHogLoaded(): boolean {
  return loaded
}

/**
 * The initialised PostHog client, or `null` when this document never ran
 * `posthog.init`. Checks the flag before the dynamic import, so a user who
 * declined analytics never fetches the SDK chunk; `__loaded` stays as the
 * second guard after the import.
 */
export async function getLoadedPostHog(): Promise<PostHog | null> {
  if (!loaded) return null
  const { default: posthog } = await import('posthog-js')
  return posthog.__loaded ? posthog : null
}
