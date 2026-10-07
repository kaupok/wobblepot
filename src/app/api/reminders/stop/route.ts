import { NextResponse } from 'next/server'
import { captureApiError } from '@/lib/errors'
import { stopRemindersByToken } from '@/lib/weekly-reminder'

/**
 * POST /api/reminders/stop
 *
 * Ends the weekly planning reminder without a sign-in (HON-1084). Two callers:
 *
 * - The stop page's button, with a JSON body `{ token }`.
 * - A mail client's RFC 8058 one-click unsubscribe, which POSTs the form body
 *   `List-Unsubscribe=One-Click` to the `List-Unsubscribe` URL. The token is
 *   then in that URL's query string.
 *
 * An unknown token answers 200 like a real one, so the link never tells
 * whether a token existed.
 */
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? (await tokenFromBody(request))
  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }

  try {
    await stopRemindersByToken(token)
    return NextResponse.json({ stopped: true })
  } catch (error) {
    captureApiError(error, { route: '/api/reminders/stop' })
    return NextResponse.json({ error: 'Failed to stop the reminders' }, { status: 500 })
  }
}

/**
 * GET /api/reminders/stop
 *
 * A mail client without one-click support opens the `List-Unsubscribe` URL.
 * A GET changes nothing, because mail scanners open every link: it sends the
 * person to the stop page and its button.
 */
export function GET(request: Request) {
  const url = new URL(request.url)
  const page = new URL('/reminders/stop', url.origin)
  const token = url.searchParams.get('token')
  if (token) page.searchParams.set('token', token)
  return NextResponse.redirect(page, 303)
}

async function tokenFromBody(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.json()
    if (body && typeof body === 'object' && 'token' in body && typeof body.token === 'string') {
      return body.token || null
    }
  } catch {
    // Not JSON: a one-click form body, whose token is in the URL.
  }
  return null
}
