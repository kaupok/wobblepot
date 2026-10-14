import 'server-only'
import { API_KEY_PATTERN, isActiveApiKeyUser, verifyApiKey } from '@/lib/api-keys'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { NO_HOUSEHOLD_MESSAGE, ToolInputError, type McpHousehold } from '@/lib/mcp/context'
import { checkRateLimit, retryAfterSeconds, type RateLimitResult } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/request-ip'

/**
 * Who is calling `GET /api/v1/*` (HON-1220), resolved from a read-only API key.
 * The checks mirror `serveAuthorized` in `src/app/api/mcp/route.ts`: a live
 * account, then the household, then the household's rate limit.
 */

export type ApiErrorCode =
  'invalid_key' | 'no_household' | 'rate_limited' | 'bad_request' | 'internal_error'

export interface ApiKeyCaller {
  userId: string
  household: McpHousehold
}

/**
 * Every v1 answer is read live, so no browser or proxy may keep a copy. No
 * CORS headers: a script or Home Assistant does not need them.
 */
const NO_STORE = { 'Cache-Control': 'no-store' } as const

export function apiJson(body: unknown): Response {
  return Response.json(body, { headers: NO_STORE })
}

/** The error body of every v1 route: `{ error, code }`, plain English for a developer. */
export function apiError(
  status: number,
  code: ApiErrorCode,
  error: string,
  headers?: Record<string, string>,
): Response {
  return Response.json({ error, code }, { status, headers: { ...NO_STORE, ...headers } })
}

export const INTERNAL_ERROR_MESSAGE = 'Wobblepot could not answer this request. Try again later.'

const INVALID_KEY_MESSAGE =
  'Send a Wobblepot API key as "Authorization: Bearer wp_…". Make one under My account → Connections.'

/** The key from `Authorization: Bearer <key>`, or null. The scheme is case-insensitive (RFC 9110). */
function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  const match = header?.match(/^Bearer\s+(\S+)\s*$/i)
  return match?.[1] ?? null
}

/**
 * Resolves the caller of a v1 route, or the `Response` to send instead:
 *
 * - `401 invalid_key`: no key, a malformed key, an unknown or revoked key, or
 *   the key of an account waiting for deletion. A malformed key is refused
 *   before any lookup.
 * - `429 rate_limited`: the client IP's `api-key-ip` bucket is spent. It is
 *   checked before the lookup, so a caller without a valid key cannot send
 *   unlimited database queries.
 * - `403 no_household`: the account has not finished onboarding, or left its
 *   household; leaving ends the key's access.
 * - `429 rate_limited` with `Retry-After`: the household's `api-key` bucket is
 *   spent. The `mcp` bucket is never touched.
 * - `500 internal_error`: a lookup failed; reported with `captureApiError`.
 */
export async function resolveApiKeyCaller(
  request: Request,
  route: string,
): Promise<ApiKeyCaller | Response> {
  const key = bearerToken(request)
  if (!key || !API_KEY_PATTERN.test(key)) return apiError(401, 'invalid_key', INVALID_KEY_MESSAGE)

  const ipLimit = await checkRateLimit(getClientIp(request), 'api-key-ip')
  if (!ipLimit.allowed) return rateLimited(ipLimit)

  let caller: ApiKeyCaller
  try {
    const verified = await verifyApiKey(key)
    if (!verified) return apiError(401, 'invalid_key', INVALID_KEY_MESSAGE)
    const { userId } = verified

    const [active, membership] = await Promise.all([
      isActiveApiKeyUser(userId),
      getHouseholdMembership(userId),
    ])
    if (!active) return apiError(401, 'invalid_key', INVALID_KEY_MESSAGE)
    if (!membership) return apiError(403, 'no_household', NO_HOUSEHOLD_MESSAGE)
    caller = { userId, household: membership.household }
  } catch (error) {
    captureApiError(error, { route })
    return apiError(500, 'internal_error', INTERNAL_ERROR_MESSAGE)
  }

  const limit = await checkRateLimit(caller.household.id, 'api-key')
  if (!limit.allowed) return rateLimited(limit)
  return caller
}

function rateLimited(limit: RateLimitResult): Response {
  return apiError(
    429,
    'rate_limited',
    `Too many requests to Wobblepot. Try again after ${limit.resetAt.toISOString()}.`,
    { 'Retry-After': String(retryAfterSeconds(limit)) },
  )
}

/**
 * One v1 read: resolve the caller, run `read` for its household, answer JSON.
 * A {@link ToolInputError} (a range the wrong way round, too many days) is the
 * caller's mistake, so it answers `400 bad_request` with its message and is not
 * reported. Anything else is reported and answers `500 internal_error`.
 */
export async function serveApiRead(
  request: Request,
  route: string,
  read: (household: McpHousehold) => Promise<unknown>,
): Promise<Response> {
  const caller = await resolveApiKeyCaller(request, route)
  if (caller instanceof Response) return caller

  try {
    return apiJson(await read(caller.household))
  } catch (error) {
    if (error instanceof ToolInputError) return apiError(400, 'bad_request', error.message)
    captureApiError(error, { route, userId: caller.userId, householdId: caller.household.id })
    return apiError(500, 'internal_error', INTERNAL_ERROR_MESSAGE)
  }
}
