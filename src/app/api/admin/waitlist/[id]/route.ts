import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { captureApiError } from '@/lib/errors'

/**
 * Remove on `/admin/waitlist` (HON-970): how a withdrawal or deletion request
 * is honoured (docs/RUNBOOKS/dsr-intake.md). The linked signup code, if any,
 * stays and expires on its own.
 */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin()
  if (guard.error) return guard.error

  try {
    const { id } = await ctx.params
    const { count } = await prisma.waitlistRequest.deleteMany({ where: { id } })
    if (count === 0) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    captureApiError(error, { route: '/api/admin/waitlist/[id]', userId: guard.session.user.id })
    return NextResponse.json({ error: 'Failed to remove waitlist request' }, { status: 500 })
  }
}
