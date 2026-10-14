import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import {
  createApiKey,
  getApiKeyViewer,
  listApiKeys,
  MAX_API_KEY_EXPIRY_DAYS,
  MAX_API_KEY_NAME_LENGTH,
} from '@/lib/api-keys'

const ROUTE = '/api/auth/user/api-keys'

/** Error codes the profile page translates; the `error` text is English, for logs. */
export type ApiKeyErrorCode = 'invalid_name' | 'invalid_expiry' | 'key_limit'

/**
 * GET /api/auth/user/api-keys
 *
 * The read-only API keys the signed-in user may see (HON-1220):
 * `[{ id, name, start, createdAt, lastUsedAt, expiresAt, expired, memberName }]`.
 * A household's owner gets every member's keys with `memberName` set; anyone
 * else gets their own, with `memberName` null (HON-1221). Never a key or a hash.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    return NextResponse.json(await listApiKeys(await getApiKeyViewer(session.user.id)))
  } catch (error) {
    captureApiError(error, { route: ROUTE, userId: session.user.id })
    return NextResponse.json({ error: 'Failed to load API keys' }, { status: 500 })
  }
}

/**
 * POST /api/auth/user/api-keys `{ name, expiresInDays? }`
 *
 * Makes a key for the signed-in user and answers `201 { key, apiKey }`. The
 * response is the only place the key appears in plain text. 400 `invalid_name`
 * for a name that is empty or longer than 60 characters after trimming, 400
 * `invalid_expiry` for an `expiresInDays` that is not a whole number from 1 to
 * 365 (null or absent is a key that does not expire, HON-1221), 400
 * `key_limit` for an 11th key.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    name?: unknown
    expiresInDays?: unknown
  } | null
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > MAX_API_KEY_NAME_LENGTH) {
    const code: ApiKeyErrorCode = 'invalid_name'
    return NextResponse.json(
      { error: `Give the key a name of 1 to ${MAX_API_KEY_NAME_LENGTH} characters`, code },
      { status: 400 },
    )
  }

  const expiresInDays = body?.expiresInDays ?? null
  if (
    expiresInDays !== null &&
    !(
      typeof expiresInDays === 'number' &&
      Number.isInteger(expiresInDays) &&
      expiresInDays >= 1 &&
      expiresInDays <= MAX_API_KEY_EXPIRY_DAYS
    )
  ) {
    const code: ApiKeyErrorCode = 'invalid_expiry'
    return NextResponse.json(
      { error: `Give expiresInDays as a whole number from 1 to ${MAX_API_KEY_EXPIRY_DAYS}`, code },
      { status: 400 },
    )
  }

  try {
    const result = await createApiKey(session.user.id, name, expiresInDays)
    if (result.status === 'limit_reached') {
      const code: ApiKeyErrorCode = 'key_limit'
      return NextResponse.json({ error: 'Too many API keys', code }, { status: 400 })
    }
    return NextResponse.json(
      { key: result.key, apiKey: result.apiKey },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    captureApiError(error, { route: ROUTE, userId: session.user.id })
    return NextResponse.json({ error: 'Failed to create the API key' }, { status: 500 })
  }
}
