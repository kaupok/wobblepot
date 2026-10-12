import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { listMcpConsents } from '@/lib/mcp/consents'

const ROUTE = '/api/auth/user/mcp-consents'

/**
 * GET /api/auth/user/mcp-consents
 *
 * The AI assistants the signed-in user has connected through the OAuth flow
 * (HON-1153): `[{ clientId, clientName, scopes, createdAt }]`. Only the
 * caller's own consents; the profile page's "Connected assistants" list reads
 * it. Next to the export and delete routes, so the account-deletion runbook
 * finds every route that touches a user's grants in one folder.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    return NextResponse.json(await listMcpConsents(session.user.id))
  } catch (error) {
    captureApiError(error, { route: ROUTE, userId: session.user.id })
    return NextResponse.json({ error: 'Failed to load connected assistants' }, { status: 500 })
  }
}
