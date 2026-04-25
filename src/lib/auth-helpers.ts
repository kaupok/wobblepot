import 'server-only'
import { serverEnv } from '@/lib/env'
import type { Session } from '@/lib/auth'

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
