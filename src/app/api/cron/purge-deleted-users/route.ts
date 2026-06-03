import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import { purgeUser } from '@/lib/auth/purge-user'
import { captureApiError } from '@/lib/errors'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/purge-deleted-users
 *
 * Daily GDPR Art. 17 purge (HON-481). Hard-deletes every account whose 30-day
 * grace window has elapsed (`purgeScheduledFor < now`). Scheduled via
 * `vercel.json` at 03:00 UTC.
 *
 * Auth: requires `Authorization: Bearer ${CRON_SECRET}`. Vercel Cron injects
 * this header automatically when the env var is set. A missing secret is a
 * misconfiguration in production (returns 500, fails loud); elsewhere the cron
 * is simply unreachable (401).
 *
 * Each user is purged in its own transaction (via `purgeUser`), so one failure
 * is logged and skipped rather than aborting the whole batch.
 */
export async function GET(request: Request) {
  const cronSecret = serverEnv.CRON_SECRET

  if (!cronSecret) {
    if (serverEnv.NEXT_PUBLIC_APP_ENV === 'production') {
      // Loud failure: a production deploy without the secret would otherwise
      // silently never purge, breaking our published 30-day retention promise.
      captureApiError(new Error('CRON_SECRET is not configured in production'), {
        route: '/api/cron/purge-deleted-users',
      })
      return NextResponse.json({ error: 'Cron not configured' }, { status: 500 })
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const now = new Date()
    const expired = await prisma.user.findMany({
      where: {
        deletedAt: { not: null },
        purgeScheduledFor: { lt: now },
      },
      select: { id: true },
    })

    let purged = 0
    for (const { id } of expired) {
      try {
        await purgeUser(id)
        purged += 1
      } catch (error) {
        // Log and continue — a single failed cascade must not block the rest.
        captureApiError(error, { route: '/api/cron/purge-deleted-users', userId: id })
      }
    }

    return NextResponse.json({ purged, scanned: expired.length })
  } catch (error) {
    captureApiError(error, { route: '/api/cron/purge-deleted-users' })
    return NextResponse.json({ error: 'Purge failed' }, { status: 500 })
  }
}
