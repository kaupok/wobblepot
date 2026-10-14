import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { revokeApiKey } from '@/lib/api-keys'

const ROUTE = '/api/auth/user/api-keys/[id]'

/**
 * DELETE /api/auth/user/api-keys/[id]
 *
 * Revoke on the profile page (HON-1220): deletes one of the signed-in user's
 * keys, so its next request to `/api/v1/*` answers 401.
 *
 * 404 when the user has no key with this id, including another user's key:
 * 403 would confirm that the key exists.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  try {
    const revoked = await revokeApiKey(session.user.id, id)
    if (!revoked) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 })
    }
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    captureApiError(error, { route: ROUTE, userId: session.user.id })
    return NextResponse.json({ error: 'Failed to revoke the API key' }, { status: 500 })
  }
}
