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

function cacheKey(origin: string): string {
  return `robots:${origin}`
}

async function readCache(origin: string): Promise<boolean | null> {
  const cached = await getRedis().get<string | number | boolean>(cacheKey(origin))
  if (cached === null || cached === undefined) return null
  if (cached === true || cached === '1' || cached === 1) return true
  if (cached === false || cached === '0' || cached === 0) return false
  return null
}

async function writeCache(origin: string, allowed: boolean): Promise<void> {
  await getRedis().set(cacheKey(origin), allowed ? '1' : '0', { ex: ROBOTS_CACHE_TTL_SECONDS })
}

/**
 * Check whether Honkadori-Bot is allowed to fetch the given URL according to
 * the origin's robots.txt. Caches the decision per-origin in Upstash for 24h.
 *
 * On fetch failure (404, 5xx, network error, timeout) we allow the request.
 * 404 is explicit permission under the Robots Exclusion spec; 5xx/network
 * errors are ambiguous and the polite-bot convention is to allow rather than
 * block user traffic on a transient issue. The 24h cache prevents hammering
 * a struggling server.
 */
export async function checkRobotsAllowed(url: string): Promise<boolean> {
  const parsed = new URL(url)
  const origin = parsed.origin

  const cached = await readCache(origin)
  if (cached !== null) return cached

  const robotsUrl = `${origin}/robots.txt`
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
      await writeCache(origin, true)
      return true
    }

    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.info('[robots] Allowing due to fetch failure', {
        origin,
        reason: `status-${response.status}`,
      })
      await writeCache(origin, true)
      return true
    }

    body = await response.text()
  } catch (error) {
    const reason =
      error instanceof DOMException && error.name === 'TimeoutError' ? 'timeout' : 'network-error'
    // eslint-disable-next-line no-console
    console.info('[robots] Allowing due to fetch failure', { origin, reason })
    await writeCache(origin, true)
    return true
  }

  const robots = robotsParser(robotsUrl, body)
  // robots-parser returns undefined when no rules apply; treat as allowed.
  const allowed = robots.isAllowed(url, HONKADORI_BOT_TOKEN) ?? true

  if (!allowed) {
    // eslint-disable-next-line no-console
    console.info('[robots] Disallowed', { origin })
  }

  await writeCache(origin, allowed)
  return allowed
}
