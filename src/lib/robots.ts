import robotsParser from 'robots-parser'
import { getRedis } from '@/lib/upstash'

export const HONKADORI_BOT_USER_AGENT = 'Honkadori-Bot/1.0 (+https://honkadori.xyz/bot)'

/**
 * The token portion of the UA, used for robots.txt matching.
 * robots.txt rules match against the token (before the space and paren comment),
 * not the full parenthesised UA string.
 */
export const HONKADORI_BOT_TOKEN = 'Honkadori-Bot/1.0'

const ROBOTS_FETCH_TIMEOUT_MS = 5_000
const ROBOTS_CACHE_TTL_SECONDS = 60 * 60 * 24
// Short TTL when we failed to reach the origin's robots.txt. We still allow
// the request (polite-bot convention), but we want to retry the real fetch
// soon after a transient blip rather than pinning "allow" for 24h.
const ROBOTS_FAILURE_CACHE_TTL_SECONDS = 60 * 5

function cacheKey(origin: string): string {
  return `robots:${origin}`
}

/**
 * Cached representation of a robots.txt response. We cache the raw body so
 * the per-URL decision is re-computed on each call — robots rules are
 * path-scoped and caching a single allow/deny decision per origin would
 * produce wrong answers for other paths on the same host.
 */
async function readCachedBody(origin: string): Promise<string | null> {
  const cached = await getRedis().get<string>(cacheKey(origin))
  if (cached === null || cached === undefined) return null
  return cached
}

async function writeCachedBody(origin: string, body: string, ttlSeconds: number): Promise<void> {
  await getRedis().set(cacheKey(origin), body, { ex: ttlSeconds })
}

function decideFromBody(url: string, robotsUrl: string, body: string, origin: string): boolean {
  // Empty body (no rules) — robots-parser returns undefined for isAllowed.
  // Treat as allowed per the Robots Exclusion spec (no policy = no restriction).
  const robots = robotsParser(robotsUrl, body)
  const allowed = robots.isAllowed(url, HONKADORI_BOT_TOKEN) ?? true

  if (!allowed) {
    // eslint-disable-next-line no-console
    console.info('[robots] Disallowed', { origin })
  }

  return allowed
}

/**
 * Check whether Honkadori-Bot is allowed to fetch the given URL according to
 * the origin's robots.txt. Caches the robots.txt *body* per origin so each
 * URL's decision is computed fresh (rules are path-scoped).
 *
 * On fetch failure (404, 5xx, network error, timeout) we allow the request.
 * 404 is explicit permission under the Robots Exclusion spec (cached 24h).
 * 5xx/network/timeout are ambiguous; the polite-bot convention is to allow
 * rather than block user traffic on a transient issue, but we cache with a
 * short TTL so we retry the fetch soon after the origin recovers.
 */
export async function checkRobotsAllowed(url: string): Promise<boolean> {
  const parsed = new URL(url)
  const origin = parsed.origin
  const robotsUrl = `${origin}/robots.txt`

  const cachedBody = await readCachedBody(origin)
  if (cachedBody !== null) {
    return decideFromBody(url, robotsUrl, cachedBody, origin)
  }

  let body: string
  try {
    const response = await fetch(robotsUrl, {
      signal: AbortSignal.timeout(ROBOTS_FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': HONKADORI_BOT_USER_AGENT },
      redirect: 'follow',
    })

    if (response.status === 404) {
      // eslint-disable-next-line no-console
      console.info('[robots] Allowing due to fetch failure', { origin, reason: 'not-found' })
      // Empty body = no rules; cached at the long TTL because 404 is an
      // explicit "no policy" signal under the Robots Exclusion spec.
      await writeCachedBody(origin, '', ROBOTS_CACHE_TTL_SECONDS)
      return true
    }

    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.info('[robots] Allowing due to fetch failure', {
        origin,
        reason: `status-${response.status}`,
      })
      await writeCachedBody(origin, '', ROBOTS_FAILURE_CACHE_TTL_SECONDS)
      return true
    }

    body = await response.text()
  } catch (error) {
    const reason =
      error instanceof DOMException && error.name === 'TimeoutError' ? 'timeout' : 'network-error'
    // eslint-disable-next-line no-console
    console.info('[robots] Allowing due to fetch failure', { origin, reason })
    await writeCachedBody(origin, '', ROBOTS_FAILURE_CACHE_TTL_SECONDS)
    return true
  }

  await writeCachedBody(origin, body, ROBOTS_CACHE_TTL_SECONDS)
  return decideFromBody(url, robotsUrl, body, origin)
}
