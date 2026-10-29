import { NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth-helpers'
import { captureApiError } from '@/lib/errors'
import { createSignupCode, listSignupCodes } from '@/lib/signup-codes'

const NOTE_MAX_LENGTH = 200

const createSchema = z.object({
  note: z.string().trim().max(NOTE_MAX_LENGTH).optional(),
})

export async function GET() {
  const guard = await requireAdmin()
  if (guard.error) return guard.error

  try {
    return NextResponse.json({ codes: await listSignupCodes() })
  } catch (error) {
    captureApiError(error, {
      route: '/api/admin/signup-codes',
      userId: guard.session.user.id,
    })
    return NextResponse.json({ error: 'Failed to fetch signup codes' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const guard = await requireAdmin()
  if (guard.error) return guard.error

  try {
    let body: unknown = {}
    try {
      const text = await request.text()
      if (text) body = JSON.parse(text)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', issues: parsed.error.issues },
        { status: 400 },
      )
    }

    const code = await createSignupCode({
      createdById: guard.session.user.id,
      note: parsed.data.note ?? null,
    })
    return NextResponse.json({ code }, { status: 201 })
  } catch (error) {
    captureApiError(error, {
      route: '/api/admin/signup-codes',
      userId: guard.session.user.id,
    })
    return NextResponse.json({ error: 'Failed to create signup code' }, { status: 500 })
  }
}
