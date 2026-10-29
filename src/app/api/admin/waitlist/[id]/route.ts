import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/auth-helpers'
import { captureApiError } from '@/lib/errors'
import { deleteWaitlistRequest, WaitlistError } from '@/lib/waitlist'

/** Remove on `/admin/waitlist` (HON-970). See `deleteWaitlistRequest`. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin()
  if (guard.error) return guard.error

  try {
    const { id } = await ctx.params
    await deleteWaitlistRequest(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof WaitlistError && error.reason === 'notFound') {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }
    captureApiError(error, { route: '/api/admin/waitlist/[id]', userId: guard.session.user.id })
    return NextResponse.json({ error: 'Failed to remove waitlist request' }, { status: 500 })
  }
}
