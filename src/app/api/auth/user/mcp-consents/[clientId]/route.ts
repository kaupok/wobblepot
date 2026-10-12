import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { disconnectMcpClient } from '@/lib/mcp/consents'

const ROUTE = '/api/auth/user/mcp-consents/[clientId]'

/**
 * DELETE /api/auth/user/mcp-consents/[clientId]
 *
 * Disconnect on the profile page (HON-1153): deletes the signed-in user's
 * consent, refresh tokens and stored access tokens for one client, so the
 * assistant's next MCP call gets 401. See `disconnectMcpClient`.
 *
 * 404 when the user has no consent for the client, including a client only
 * another user connected: 403 would confirm that someone else's grant exists.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { clientId } = await params
  try {
    const disconnected = await disconnectMcpClient(session.user.id, clientId)
    if (!disconnected) {
      return NextResponse.json({ error: 'Connected assistant not found' }, { status: 404 })
    }
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    captureApiError(error, { route: ROUTE, userId: session.user.id })
    return NextResponse.json({ error: 'Failed to disconnect the assistant' }, { status: 500 })
  }
}
