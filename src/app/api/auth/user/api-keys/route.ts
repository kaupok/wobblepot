import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { createApiKey, listApiKeys, MAX_API_KEY_NAME_LENGTH } from '@/lib/api-keys'

const ROUTE = '/api/auth/user/api-keys'

/** Error codes the profile page translates; the `error` text is English, for logs. */
export type ApiKeyErrorCode = 'invalid_name' | 'key_limit'

/**
 * GET /api/auth/user/api-keys
 *
 * The signed-in user's own read-only API keys (HON-1220):
 * `[{ id, name, start, createdAt, lastUsedAt }]`. Never a key or a hash.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    return NextResponse.json(await listApiKeys(session.user.id))
  } catch (error) {
    captureApiError(error, { route: ROUTE, userId: session.user.id })
    return NextResponse.json({ error: 'Failed to load API keys' }, { status: 500 })
  }
}

/**
 * POST /api/auth/user/api-keys `{ name }`
 *
 * Makes a key for the signed-in user and answers `201 { key, apiKey }`. The
 * response is the only place the key appears in plain text. 400 `invalid_name`
 * for a name that is empty or longer than 60 characters after trimming, 400
 * `key_limit` for an 11th key.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { name?: unknown } | null
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > MAX_API_KEY_NAME_LENGTH) {
    const code: ApiKeyErrorCode = 'invalid_name'
    return NextResponse.json(
      { error: `Give the key a name of 1 to ${MAX_API_KEY_NAME_LENGTH} characters`, code },
      { status: 400 },
    )
  }

  try {
    const result = await createApiKey(session.user.id, name)
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
