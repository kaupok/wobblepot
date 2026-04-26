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

// Shape selected from Prisma. Includes the nested `usedBy` relation so we
// can flatten its email into a top-level field below.
const CODE_SELECT = {
  id: true,
  code: true,
  createdAt: true,
  usedAt: true,
  expiresAt: true,
  note: true,
  usedBy: { select: { email: true } },
} as const

interface PrismaSignupCodeRow {
  id: string
  code: string
  createdAt: Date
  usedAt: Date | null
  expiresAt: Date | null
  note: string | null
  usedBy: { email: string } | null
}

/**
 * Flatten the Prisma row to the wire shape the admin client expects
 * (`SignupCodeRow` in `SignupCodesClient.tsx`). Keeping the API response
 * shape in lockstep with the page-level `initialCodes` prop avoids the
 * "Used by unknown" regression when `useQuery` refetches.
 */
function serialiseCode(row: PrismaSignupCodeRow) {
  return {
    id: row.id,
    code: row.code,
    createdAt: row.createdAt.toISOString(),
    usedAt: row.usedAt ? row.usedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    note: row.note,
    usedByEmail: row.usedBy?.email ?? null,
  }
}

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

  return NextResponse.json({ codes: codes.map(serialiseCode) })
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

  return NextResponse.json({ code: serialiseCode(created) }, { status: 201 })
}
