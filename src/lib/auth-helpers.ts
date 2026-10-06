import 'server-only'
import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { serverEnv } from '@/lib/env'
import { auth, type Session } from '@/lib/auth'

/**
 * Beta admin gate. The launch ships with a single admin (one person on the
 * core team) — checking against `ADMIN_EMAIL` keeps the surface area minimal
 * without introducing a roles/permissions system. Replace with a role-based
 * check before broadening admin access beyond beta.
 */
export function isAdmin(session: Session | null | undefined): boolean {
  const email = session?.user?.email
  if (!email) return false
  return email.toLowerCase() === serverEnv.ADMIN_EMAIL.toLowerCase()
}

/**
 * `isAdmin` for surfaces that render on every page, such as the header's
 * account menus (HON-1092). An unset or invalid `ADMIN_EMAIL` means "not
 * admin" here rather than a throw, because local dev and the E2E Neon
 * branches run without it. The `/admin` gate keeps `isAdmin`, which throws on
 * a missing value on purpose (docs/ENVIRONMENT_SETUP.md → Admin email).
 *
 * The presence check comes first so an unset variable skips `serverEnv`, whose
 * failed validation logs an error on every page load.
 */
export function isAdminIfConfigured(session: Session | null | undefined): boolean {
  if (!process.env.ADMIN_EMAIL) return false
  try {
    return isAdmin(session)
  } catch {
    return false
  }
}

/**
 * The gate for `/api/admin/**` routes. Returns the admin session, or the
 * response to send instead: 401 without a session, 404 (not 403) for anyone
 * else, mirroring the `/admin` pages' `notFound()` so the route does not
 * advertise that it exists.
 */
export async function requireAdmin(): Promise<
  { session: Session; error?: never } | { session?: never; error: NextResponse }
> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isAdmin(session))
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { session }
}
