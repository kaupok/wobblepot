import { NextResponse } from 'next/server'

import { purgeExpiredOauthTokens } from '@/lib/auth/purge-expired-oauth-tokens'
import { PURGE_MAX_USERS_PER_RUN, purgeDueUsers } from '@/lib/auth/purge-user'
import { serverEnv } from '@/lib/env'
import { captureApiError } from '@/lib/errors'
import { purgeExpiredDeletedMealImages } from '@/lib/meal-images/purge-deleted-meal-images'
import { discardMealImage } from '@/lib/meal-images/storage'
import { purgeExpiredWaitlistRequests } from '@/lib/waitlist'

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
 *
 * When more than `PURGE_MAX_USERS_PER_RUN` users are due, it purges none,
 * reports the error and answers 500 (HON-1509): so many at once is more likely
 * a bug than real requests, and a purge cannot be undone. The other purges
 * below still run. Operator steps: `docs/RUNBOOKS/gdpr-deletion.md` → Cap
 * tripped.
 *
 * The same run enforces the waitlist retention (HON-846): unconfirmed invite
 * requests older than 7 days and confirmed ones older than 6 months are
 * deleted (`purgeExpiredWaitlistRequests`). It lives here rather than in a
 * cron of its own because `vercel.json` schedules this one cron, and this
 * route already owns the published retention promises.
 *
 * For the same reason it deletes expired OAuth access and refresh token rows
 * (HON-1165, `purgeExpiredOauthTokens`), as the privacy policy and the DPIA
 * promise.
 *
 * It also clears the image of every recipe deleted more than 30 days ago
 * (HON-1336, `purgeExpiredDeletedMealImages`), once the recipe can no longer
 * be restored.
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
    const users = await purgeDueUsers(now, (userId, error) => {
      // Log and continue — a single failed cascade must not block the rest.
      captureApiError(error, { route: '/api/cron/purge-deleted-users', userId })
    })

    const waitlist = await purgeExpiredWaitlistRequests(now)
    const oauthTokens = await purgeExpiredOauthTokens(now)
    const mealImageUrls = await purgeExpiredDeletedMealImages(now)
    // After each clear has committed, so a rolled-back clear keeps its file.
    for (const url of mealImageUrls) {
      await discardMealImage(url, '/api/cron/purge-deleted-users')
    }

    const others = { waitlist, oauthTokens, mealImages: mealImageUrls.length }

    if (users.capExceeded) {
      captureApiError(new Error('Purge cap exceeded'), {
        route: '/api/cron/purge-deleted-users',
        due: users.due,
        cap: PURGE_MAX_USERS_PER_RUN,
      })
      return NextResponse.json(
        { error: 'Purge cap exceeded', due: users.due, cap: PURGE_MAX_USERS_PER_RUN, ...others },
        { status: 500 },
      )
    }

    return NextResponse.json({ purged: users.purged, scanned: users.scanned, ...others })
  } catch (error) {
    captureApiError(error, { route: '/api/cron/purge-deleted-users' })
    return NextResponse.json({ error: 'Purge failed' }, { status: 500 })
  }
}
