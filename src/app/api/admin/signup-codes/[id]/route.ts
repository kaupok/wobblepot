import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { isAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { captureApiError } from '@/lib/errors'

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const { id } = await ctx.params

    // Only delete unused codes — claimed codes are an audit record.
    // deleteMany lets us combine the predicate without first SELECTing.
    const result = await prisma.signupCode.deleteMany({
      where: { id, usedAt: null },
    })

    if (result.count === 0) {
      // Either the code doesn't exist or it has already been claimed. The
      // distinction matters for the admin so we can suggest re-loading.
      const existing = await prisma.signupCode.findUnique({
        where: { id },
        select: { usedAt: true },
      })
      if (!existing) {
        return NextResponse.json({ error: 'Code not found' }, { status: 404 })
      }
      return NextResponse.json(
        { error: 'Code has already been claimed and cannot be revoked.' },
        { status: 409 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    captureApiError(error, { route: '/api/admin/signup-codes/[id]', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to revoke signup code' }, { status: 500 })
  }
}
