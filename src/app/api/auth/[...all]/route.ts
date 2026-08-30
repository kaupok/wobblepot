import { auth } from '@/lib/auth'
import { toNextJsHandler } from 'better-auth/next-js'
import { checkRateLimit, retryAfterSeconds, type RateLimitFeature } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/request-ip'
import { timeSignupStep } from '@/lib/signup-timing'

const { GET, POST: handleBetterAuthPost } = toNextJsHandler(auth)

export { GET }

// Better Auth endpoint suffix → rate-limit feature. The suffix is matched
// against the request pathname's tail so we're resilient to the `/api/auth`
// prefix being anything the deploy configures. The Better Auth endpoint IDs
// themselves (e.g. `/sign-in/email`) are stable — see better-auth's
// createAuthEndpoint declarations.
const RATE_LIMITED_PATHS: ReadonlyArray<{ suffix: string; feature: RateLimitFeature }> = [
  { suffix: '/sign-up/email', feature: 'sign-up' },
  { suffix: '/sign-in/email', feature: 'sign-in' },
  { suffix: '/request-password-reset', feature: 'forgot-password' },
]

function featureForPath(pathname: string): RateLimitFeature | null {
  for (const { suffix, feature } of RATE_LIMITED_PATHS) {
    if (pathname.endsWith(suffix)) return feature
  }
  return null
}

async function maybeRateLimit(request: Request): Promise<Response | null> {
  let pathname: string
  try {
    pathname = new URL(request.url).pathname
  } catch {
    return null
  }

  const feature = featureForPath(pathname)
  if (!feature) return null

  const ip = getClientIp(request)
  const result = await checkRateLimit(ip, feature)
  if (result.allowed) return null

  // Generic body: must not differentiate existing vs. non-existing accounts
  // or name which of (sign-up / sign-in / forgot-password) drew the hit.
  return new Response(JSON.stringify({ error: 'Too many requests' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(retryAfterSeconds(result)),
    },
  })
}

function isSignUpEmail(request: Request): boolean {
  try {
    return new URL(request.url).pathname.endsWith('/sign-up/email')
  } catch {
    return false
  }
}

export async function POST(request: Request): Promise<Response> {
  const limited = await maybeRateLimit(request)
  if (limited) return limited
  // Time the whole sign-up POST so its total sits next to the per-step lines
  // (hibp / scrypt / invite-code) logged inside Better Auth's hooks (HON-569).
  if (isSignUpEmail(request)) {
    return timeSignupStep('total', () => handleBetterAuthPost(request))
  }
  return handleBetterAuthPost(request)
}
