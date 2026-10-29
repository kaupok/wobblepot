import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/auth-helpers'
import { captureApiError } from '@/lib/errors'
import { revokeSignupCode, SignupCodeError } from '@/lib/signup-codes'

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin()
  if (guard.error) return guard.error
  const { session } = guard

  try {
    const { id } = await ctx.params
    await revokeSignupCode(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof SignupCodeError) {
      return error.reason === 'notFound'
        ? NextResponse.json({ error: 'Code not found' }, { status: 404 })
        : NextResponse.json(
            { error: 'Code has already been claimed and cannot be revoked.' },
            { status: 409 },
          )
    }
    captureApiError(error, { route: '/api/admin/signup-codes/[id]', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to revoke signup code' }, { status: 500 })
  }
}
