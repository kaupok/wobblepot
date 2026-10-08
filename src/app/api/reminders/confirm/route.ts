import { NextResponse } from 'next/server'
import { captureApiError } from '@/lib/errors'
import { confirmReminderToken } from '@/lib/weekly-reminder'

/**
 * POST /api/reminders/confirm
 *
 * The confirm page's button (HON-1113), with a JSON body `{ token }`. Confirms
 * the address the weekly reminder goes to, without a sign-in, and answers
 * `{ confirmed }`: false for an unknown or expired token, or a reminder that
 * is off. There is no GET: a mail scanner that opens the link must not
 * confirm a stranger's inbox.
 */
export async function POST(request: Request) {
  const token = await tokenFromBody(request)
  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }

  try {
    const confirmed = await confirmReminderToken(token)
    return NextResponse.json({ confirmed })
  } catch (error) {
    captureApiError(error, { route: '/api/reminders/confirm' })
    return NextResponse.json({ error: 'Failed to confirm the reminder' }, { status: 500 })
  }
}

async function tokenFromBody(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.json()
    if (body && typeof body === 'object' && 'token' in body && typeof body.token === 'string') {
      return body.token || null
    }
  } catch {
    // Not JSON: no token.
  }
  return null
}
