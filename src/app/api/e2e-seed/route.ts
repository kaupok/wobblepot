import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { RATE_LIMIT_BYPASS_ACTIVE } from '@/lib/rate-limit'

/**
 * Test-only seed endpoint for E2E tests. Mints a single-use invite code
 * without going through the admin auth gate, so Playwright tests can satisfy
 * the HON-488 invite-code field without juggling admin sessions.
 *
 * Gated on `RATE_LIMIT_BYPASS_ACTIVE`, which itself only activates when
 * `NEXT_PUBLIC_APP_ENV` is one of `ci` / `test` / `dev` (see
 * `src/lib/rate-limit.ts`). Production / staging / preview never set
 * `E2E_DISABLE_RATE_LIMIT=1`, so the route returns 404 there — the same
 * shape `/admin/signup-codes` returns to non-admins, so it does not
 * advertise its existence.
 *
 * Why HTTP rather than Prisma directly in the test helper: the generated
 * Prisma client is bundled for Next.js and does not import cleanly in
 * Playwright's plain-Node runtime (CJS/ESM mismatch). Going through this
 * endpoint reuses the app's Prisma instance and stays clear of that.
 */
export async function POST() {
  if (!RATE_LIMIT_BYPASS_ACTIVE) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const code = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  await prisma.signupCode.create({ data: { code } })

  return NextResponse.json({ code }, { status: 201 })
}

export async function DELETE(request: Request) {
  if (!RATE_LIMIT_BYPASS_ACTIVE) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  if (!code) {
    return NextResponse.json({ error: 'Missing ?code=<value>' }, { status: 400 })
  }

  await prisma.signupCode.deleteMany({ where: { code } })
  return NextResponse.json({ ok: true })
}
