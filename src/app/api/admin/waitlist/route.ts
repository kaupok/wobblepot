import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { captureApiError } from '@/lib/errors'
import { listConfirmedWaitlistRequests } from '@/lib/waitlist'

/** The confirmed waitlist requests for `/admin/waitlist` (HON-970). */
export async function GET() {
  const guard = await requireAdmin()
  if (guard.error) return guard.error

  try {
    return NextResponse.json({ requests: await listConfirmedWaitlistRequests() })
  } catch (error) {
    captureApiError(error, { route: '/api/admin/waitlist', userId: guard.session.user.id })
    return NextResponse.json({ error: 'Failed to fetch waitlist requests' }, { status: 500 })
  }
}
