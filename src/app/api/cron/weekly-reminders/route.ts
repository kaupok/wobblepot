import { NextResponse } from 'next/server'
import { serverEnv } from '@/lib/env'
import { captureApiError } from '@/lib/errors'
import { sendWeeklyReminders } from '@/lib/weekly-reminder'

export const dynamic = 'force-dynamic'

// Sends are paced 500 ms apart (`sendWeeklyReminders`), so a run with a few
// hundred reminders outlasts the default function duration.
export const maxDuration = 300

/**
 * GET /api/cron/weekly-reminders
 *
 * Daily send of the opt-in weekly planning reminder (HON-1084). Scheduled via
 * `vercel.json` at 16:00 UTC: 17:00 in London, 18:00 or 19:00 in Tallinn. Each
 * member is sent to only on their chosen weekday in the household timezone,
 * and only when next week has no meals planned (`sendWeeklyReminders`).
 *
 * Auth as `/api/cron/purge-deleted-users`: `Authorization: Bearer
 * ${CRON_SECRET}`, which Vercel Cron injects. A missing secret returns 500 in
 * production and 401 elsewhere. One member's failure is logged and the run
 * goes on.
 */
export async function GET(request: Request) {
  const cronSecret = serverEnv.CRON_SECRET

  if (!cronSecret) {
    if (serverEnv.NEXT_PUBLIC_APP_ENV === 'production') {
      // Loud failure: without the secret the reminders silently never go out.
      captureApiError(new Error('CRON_SECRET is not configured in production'), {
        route: '/api/cron/weekly-reminders',
      })
      return NextResponse.json({ error: 'Cron not configured' }, { status: 500 })
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    return NextResponse.json(await sendWeeklyReminders())
  } catch (error) {
    captureApiError(error, { route: '/api/cron/weekly-reminders' })
    return NextResponse.json({ error: 'Reminder run failed' }, { status: 500 })
  }
}
