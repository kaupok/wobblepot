/**
 * Server-side check against the Have I Been Pwned (HIBP) range API
 * using k-anonymity. The plaintext password and full hash never leave
 * this process — only the first 5 hex chars of the SHA-1 are sent.
 *
 * Fail-open: any network error, timeout, or non-OK response is logged
 * and treated as "not breached" so a HIBP outage cannot block sign-up.
 */

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range'
const HIBP_TIMEOUT_MS = 2000

async function sha1Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buffer = await crypto.subtle.digest('SHA-1', data)
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

export async function isPasswordBreached(password: string): Promise<boolean> {
  if (!password) return false

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), HIBP_TIMEOUT_MS)

  try {
    const hash = await sha1Hex(password)
    const prefix = hash.slice(0, 5)
    const suffix = hash.slice(5)

    const response = await fetch(`${HIBP_RANGE_URL}/${prefix}`, {
      signal: controller.signal,
      headers: {
        'Add-Padding': 'true',
        'User-Agent': 'Honkadori-Password-Check',
      },
    })

    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[breached-password] HIBP returned ${response.status}; allowing sign-up`)
      return false
    }

    const body = await response.text()
    for (const line of body.split('\n')) {
      const [hashSuffix, countRaw] = line.split(':')
      if (!hashSuffix || !countRaw) continue
      if (hashSuffix.trim().toUpperCase() !== suffix) continue
      const count = Number.parseInt(countRaw, 10)
      if (Number.isFinite(count) && count > 0) return true
    }
    return false
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[breached-password] HIBP check failed; allowing sign-up', error)
    return false
  } finally {
    clearTimeout(timeout)
  }
}
