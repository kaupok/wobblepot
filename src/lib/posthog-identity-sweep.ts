/**
 * Delete the PostHog identity posthog-js left in browser storage, without
 * loading posthog-js (HON-1051).
 *
 * With the SDK loaded, `opt_out_capturing()` deletes it (HON-1002). A browser
 * that withdrew consent before that shipped, or before the SDK finished its
 * idle-callback init, never loads the SDK again, because `PostHogProvider`
 * does not init without consent (HON-999). This sweep covers those browsers.
 *
 * Every key posthog-js 1.435.8 writes for the identity starts with the
 * persistence name `ph_<token>_posthog` (`posthog-persistence.js:117`): the
 * main entry, the `__flags` / `__surveys` localStorage group entries
 * (`posthog-persistence.js:904`), the `_cpm` cookie metadata
 * (`storage.js:312`) and the sessionStorage `_cookie_identity_change_pending`
 * flag (`posthog-persistence.js:81`). The consent flag `__ph_opt_in_out_<token>`
 * holds no identity and does not match the prefix, so it stays.
 *
 * No posthog-js import, value or type: the SDK must stay out of the bundle for
 * a user who declined (`posthog-bundle-boundary.test.ts`).
 */

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

/**
 * The domains a posthog-js cookie for `hostname` can sit on, besides the
 * host-only cookie.
 *
 * With `cross_subdomain_cookie` (on by default, except on `*.vercel.app` and
 * similar hosts), `chooseCookieDomain` (`storage.js:100`) sets the cookie on
 * the shortest suffix of the hostname that the browser accepts, found by
 * probing with test cookies. Every suffix it can pick is in this list, so
 * expiring on all of them needs no probe. A browser rejects a write on a public
 * suffix such as `.com`, so those entries do nothing.
 */
export function postHogCookieDomains(hostname: string): string[] {
  if (hostname === 'localhost' || IPV4.test(hostname) || hostname.includes(':')) return []
  const labels = hostname.split('.')
  const domains: string[] = []
  for (let i = 0; i <= labels.length - 2; i++) {
    domains.push(labels.slice(i).join('.'))
  }
  return domains
}

function removeMatchingKeys(getStorage: () => Storage, prefix: string): void {
  try {
    const storage = getStorage()
    // Collect first: removing while indexing shifts the remaining keys.
    const keys: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key?.startsWith(prefix)) keys.push(key)
    }
    for (const key of keys) storage.removeItem(key)
  } catch {
    // Storage can throw in private windows and sandboxed frames.
  }
}

function expireMatchingCookies(prefix: string, hostname: string): void {
  try {
    const names = document.cookie
      .split(';')
      .map((cookie) => (cookie.split('=')[0] ?? '').trim())
      .filter((name) => name.startsWith(prefix))
    if (names.length === 0) return
    const domains = postHogCookieDomains(hostname)
    for (const name of names) {
      const expired = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; path=/`
      document.cookie = expired
      for (const domain of domains) {
        document.cookie = `${expired}; domain=.${domain}`
      }
    }
  } catch {
    // `document.cookie` throws on some documents, e.g. a `data:` URL.
  }
}

/** Remove every `ph_<token>_posthog*` entry from localStorage, sessionStorage and cookies. */
export function clearStoredPostHogIdentity(
  token: string,
  hostname: string = window.location.hostname,
): void {
  const prefix = `ph_${token}_posthog`
  removeMatchingKeys(() => window.localStorage, prefix)
  removeMatchingKeys(() => window.sessionStorage, prefix)
  expireMatchingCookies(prefix, hostname)
}
