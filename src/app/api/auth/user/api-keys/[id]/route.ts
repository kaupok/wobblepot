import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

import { getApiKeyViewer, revokeApiKey } from '@/lib/api-keys'
import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'

const ROUTE = '/api/auth/user/api-keys/[id]'

/**
 * DELETE /api/auth/user/api-keys/[id]
 *
 * Revoke on My account → Connections (HON-1220): deletes one of the signed-in user's
 * keys, or for a household's owner any member's key (HON-1221), so its next
 * request to `/api/v1/*` answers 401.
 *
 * 404 when the user may not revoke a key with this id, including a key of
 * another member or another household: 403 would confirm that the key exists.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  try {
    const revoked = await revokeApiKey(await getApiKeyViewer(session.user.id), id)
    if (!revoked) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 })
    }
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    captureApiError(error, { route: ROUTE, userId: session.user.id })
    return NextResponse.json({ error: 'Failed to revoke the API key' }, { status: 500 })
  }
}
