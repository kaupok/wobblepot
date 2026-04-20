/**
 * Client IP extraction for rate limiting and audit logging.
 *
 * Precedence:
 *   1. `x-vercel-forwarded-for` — set by Vercel's edge; cannot be client-spoofed
 *      when we're actually deployed on Vercel. Preferred whenever present.
 *   2. `x-forwarded-for` — standard proxy chain header. The first entry is the
 *      client-most hop. Used for non-Vercel environments (local dev, custom
 *      proxies). On Vercel this header also exists but is lower-trust than
 *      the platform-specific one.
 *   3. `'unknown'` — last-resort sentinel so rate-limiting still applies (as a
 *      shared bucket) instead of silently skipping enforcement.
 */
export function getClientIp(request: Request): string {
  const vercel = request.headers.get('x-vercel-forwarded-for')
  if (vercel) {
    const trimmed = vercel.trim()
    if (trimmed) return trimmed
  }

  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    for (const entry of forwarded.split(',')) {
      const trimmed = entry.trim()
      if (trimmed) return trimmed
    }
  }

  return 'unknown'
}
