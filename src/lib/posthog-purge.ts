import 'server-only'
import { serverEnv } from '@/lib/env'
import { captureApiError } from '@/lib/errors'

const PURGE_ROUTE = '/api/cron/purge-deleted-users'
const TIMEOUT_MS = 10_000

/** Statuses that mean the key or project id is wrong, not that PostHog is down. */
const CONFIG_ERROR_STATUSES = new Set([401, 403, 404])

/** PostHog's per-call cap on `distinct_ids` (`posthog/api/person.py`). */
const MAX_DISTINCT_IDS = 1000

interface BulkDeleteResponse {
  deletion_errors?: Array<{ person_uuid?: string }>
}

/**
 * Deletes the PostHog persons behind `distinctIds`, with their events, as part
 * of an account purge (HON-907).
 *
 * PostHog identifies a person by the user id (`posthog.identify` and
 * `captureApiError`), and AI usage events attribute to the household id, so the
 * purge passes the user id plus the id of every household it is about to
 * delete. An id PostHog has never seen (a user who never accepted analytics) is
 * not an error: the call just matches no person.
 *
 * Returns `'skipped'` without calling PostHog when PostHog is disabled (no
 * project token: nothing was ever sent) or under Vitest, mirroring
 * `getPosthogServer`. When PostHog is enabled but the purge key, admin host or
 * project id is unset, or PostHog rejects them (401, 403, 404), it captures
 * one error carrying the user id and the distinct ids, and returns
 * `'skipped'`, so the database purge is never blocked on the key; those
 * persons are swept by hand later (`docs/RUNBOOKS/gdpr-deletion.md`).
 *
 * Throws on a network error, a timeout, any other non-2xx response, or a 2xx response
 * whose `deletion_errors` is non-empty — PostHog reports per-person failures
 * there rather than with a status code. `purgeUser` lets the throw propagate,
 * so the user row stays and the next nightly run retries.
 */
export async function deletePosthogPersons(
  distinctIds: string[],
  context: { userId: string },
): Promise<'deleted' | 'skipped'> {
  if (process.env.VITEST) return 'skipped'
  if (!serverEnv.NEXT_PUBLIC_POSTHOG_KEY) return 'skipped'

  const apiKey = serverEnv.POSTHOG_PURGE_API_KEY
  const host = serverEnv.POSTHOG_CLI_HOST
  const projectId = serverEnv.POSTHOG_CLI_PROJECT_ID
  if (!apiKey || !host || !projectId) {
    captureApiError(
      new Error('POSTHOG_PURGE_API_KEY is not configured; PostHog person not purged'),
      // `distinctIds` carries the household ids as well, which are gone from
      // the database once the purge commits: the hand sweep needs them.
      { route: PURGE_ROUTE, userId: context.userId, distinctIds },
    )
    return 'skipped'
  }

  // A purge passes one user id plus the households it deletes, far below the
  // cap; a breach means a caller bug, so fail rather than silently truncate.
  if (distinctIds.length > MAX_DISTINCT_IDS) {
    throw new Error(`PostHog bulk delete accepts at most ${MAX_DISTINCT_IDS} distinct ids`)
  }

  const url = new URL(`/api/projects/${projectId}/persons/bulk_delete/`, host)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ distinct_ids: distinctIds, delete_events: true }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  // A rejected key (revoked, rotated, or missing `person:write`) or a wrong
  // project id is a configuration problem like an unset key: retrying cannot
  // clear it, so capture it and let the database purge go ahead rather than
  // hold every due account until someone fixes the key.
  if (CONFIG_ERROR_STATUSES.has(response.status)) {
    captureApiError(
      new Error(
        `PostHog purge request rejected (status ${response.status}); PostHog person not purged`,
      ),
      { route: PURGE_ROUTE, userId: context.userId, distinctIds, statusCode: response.status },
    )
    return 'skipped'
  }

  if (!response.ok) {
    throw new Error(`PostHog person bulk delete failed with status ${response.status}`)
  }

  const body = (await response.json().catch(() => ({}))) as BulkDeleteResponse
  if (body.deletion_errors && body.deletion_errors.length > 0) {
    throw new Error(
      `PostHog person bulk delete reported ${body.deletion_errors.length} deletion error(s)`,
    )
  }

  return 'deleted'
}
