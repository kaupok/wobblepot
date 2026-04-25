import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { isAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'

const NOTE_MAX_LENGTH = 200

const createSchema = z.object({
  note: z.string().trim().max(NOTE_MAX_LENGTH).optional(),
})

// Shape returned by both GET and POST so the admin client can render a row
// from either response without branching on which endpoint produced it.
const CODE_SELECT = {
  id: true,
  code: true,
  createdAt: true,
  usedAt: true,
  expiresAt: true,
  note: true,
  usedBy: { select: { email: true } },
} as const

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isAdmin(session)) {
    // Mirror /admin/signup-codes' notFound() — don't leak that the route exists.
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }
  return { session }
}

export async function GET() {
  const guard = await requireAdmin()
  if (guard.error) return guard.error

  const codes = await prisma.signupCode.findMany({
    take: 100,
    orderBy: { createdAt: 'desc' },
    select: CODE_SELECT,
  })

  return NextResponse.json({ codes })
}

export async function POST(request: Request) {
  const guard = await requireAdmin()
  if (guard.error) return guard.error

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

  const code = nanoid(12)
  const created = await prisma.signupCode.create({
    data: {
      code,
      createdById: guard.session.user.id,
      note: parsed.data.note ?? null,
    },
    select: CODE_SELECT,
  })

  return NextResponse.json({ code: created }, { status: 201 })
}
