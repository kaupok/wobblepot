import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { exportUserData } from '@/lib/auth/export'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'
import { captureApiError } from '@/lib/errors'

/**
 * GET /api/auth/user/export
 *
 * GDPR Art. 20 / UK-GDPR right-to-portability endpoint. Returns the
 * authenticated user's personal data as a JSON attachment, at most 3 a day.
 *
 * What the file holds, and what it redacts, is `exportUserData`
 * (`@/lib/auth/export`); this route owns the session, the rate limit and the
 * envelope.
 */

const SCHEMA_VERSION = 1

export async function GET() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id

  const rateLimitResult = await checkRateLimit(userId, 'data-export')
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        message: `Maximum ${rateLimitResult.limit} data exports per day`,
        resetAt: rateLimitResult.resetAt.toISOString(),
      },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSeconds(rateLimitResult)) },
      },
    )
  }

  try {
    const payload = await exportUserData(userId)

    const now = new Date()
    const envelope = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: now.toISOString(),
      ...payload,
    }

    const dateStr = now.toISOString().slice(0, 10)
    const filename = `wobblepot-export-${userId}-${dateStr}.json`

    return new NextResponse(JSON.stringify(envelope), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    captureApiError(error, { route: '/api/auth/user/export', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to export data' }, { status: 500 })
  }
}
