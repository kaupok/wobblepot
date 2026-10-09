# Account deletion runbook (GDPR Art. 17)

Operator reference for the 30-day grace-window account deletion flow (HON-481). GDPR Art. 17 (right to erasure) plus the privacy policy's published retention promise (account data is "purged after a 30-day grace period; the purge runs nightly, so deletion happens within a day of that period ending") require that a user can request deletion, recover during a grace window, and be provably purged afterward. This runbook documents what gets deleted, the recovery procedure, and the backup residual window.

## Flow

```
User clicks "Delete account" (/profile → DeleteAccountDialog)
        │
        ▼
DELETE /api/auth/user
  • sole-owner guard: rejects only when another member has an account (the
    owner must remove the other members first); members without an account
    do not block (HON-881)
  • set user.deletedAt = now, user.purgeScheduledFor = first 03:00 UTC run
    strictly after (now + 30 days)  ← the real deletion instant (see note below)
  • delete all sessions  → signed out everywhere
  • send confirmation email (states purge date + how to cancel)
        │
        ▼
[ 30-day grace window ]
  • sign-in blocked: databaseHooks.session.create.before throws a generic
    "Invalid email or password" (src/lib/auth/soft-delete-guard.ts)
  • household data + the user row remain intact
  • invites to the owner's household cannot be claimed (the join route
    answers as for an expired invite), so no account holder joins a
    household the purge is about to delete
  • recovery = operator clears the two timestamps (see below)
        │
        ▼
Daily cron — 03:00 UTC (vercel.json → /api/cron/purge-deleted-users)
  • auth: Authorization: Bearer ${CRON_SECRET}
  • find users where deletedAt IS NOT NULL AND purgeScheduledFor < now
  • purgeUser(id) per user:
      1. delete the PostHog person + events for the user id, and for each
         household the purge will delete (before the transaction; a failure
         leaves the user in place for the next run; an unset
         POSTHOG_PURGE_API_KEY skips with a captured error) (HON-907)
      2. database cascade, in its own transaction
      3. Vercel Blob meal images of deleted households (best effort)
        │
        ▼
Hard cascade complete → row gone → backup copies clear within ~24h (Neon PITR)
```

The hard cascade lives in `src/lib/auth/purge-user.ts` (`purgeUser`), shared by the cron. The PostHog call is `deletePosthogPersons` in `src/lib/posthog-purge.ts`. The soft-delete and the cron never run destructive SQL by hand — they use Prisma + the schema's `onDelete: Cascade` rules.

### Why `purgeScheduledFor` is aligned to the cron run

`purgeScheduledFor` is not a bare `now + 30 days`; it is the **first 03:00 UTC cron run strictly after** that mark (`computePurgeInstant` in `route.ts`, keyed off `PURGE_CRON_UTC_HOUR`, which must match `vercel.json`). Two consequences:

- **The confirmation email's date is the real deletion date**, not an estimate that the once-daily cron then misses by a day.
- **The user always gets at least the full 30 days** to recover — we never purge early, because deletion is irreversible and erring toward keeping data is the safer failure. The one exception is a user who waives the grace window in writing: see [Immediate erasure](#immediate-erasure-on-written-request).
- **Trade-off:** retention is therefore 30 days **plus up to one cron interval (≤24h)**. The privacy policy and terms state exactly that: "purged after a 30-day grace period; the purge runs nightly, so deletion happens within a day of that period ending" (HON-907, correcting the earlier "within 30 days" from HON-457). Tighten by running the cron more than once daily if a stricter bound is ever required, and update that wording with it. This is the deliberate product call from the HON-481 review — favour the recovery guarantee over a to-the-minute retention bound.

## Per-model cascade table

What happens to each model when a user account is purged. Classification:

- **personal** — belongs to the user alone; always deleted.
- **user-owned-household** — a household where the user is the owner **and** the only member with an account; the whole household is deleted, including its members without an account (the rows the owner added by name, typically children). Those members never block the deletion (HON-881).
- **household-shared** — data owned by a household; deleted **only** when its household is deleted (i.e. no other member had an account). In a household with another account-holding member, the user leaves and this data is retained for them.
- **global-reference** — not owned by any single user; never deleted on account purge.

| Model (`table`)                     | Classification                           | Fate on account purge                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`                              | personal                                 | **Deleted** — the account row.                                                                                                                                                                                                                                                                                                                 |
| `session`                           | personal                                 | **Deleted** — explicitly at soft-delete (sign-out) and again on user delete (`onDelete: Cascade`).                                                                                                                                                                                                                                             |
| `account` (Better Auth credentials) | personal                                 | **Deleted** — `deleteMany` in the cascade + `onDelete: Cascade`. Password hashes go with it.                                                                                                                                                                                                                                                   |
| `verification`                      | global-reference                         | **Not touched** — keyed by email/identifier, no FK to `user`. Pending rows self-expire (short TTL).                                                                                                                                                                                                                                            |
| `signup_code`                       | global-reference (audit)                 | **Retained, unlinked** — `createdById` / `usedById` set to `NULL` (`onDelete: SetNull`). The code's usage history survives without pointing at a deleted user.                                                                                                                                                                                 |
| `household`                         | user-owned-household                     | **Deleted** when the user is the owner and the only member with an account, members without an account included; **retained** otherwise.                                                                                                                                                                                                       |
| `household_member`                  | personal (the membership)                | **Deleted** — the user's own membership (`onDelete: Cascade` from `user`), and with it the weekly reminder's day, consent time, stop token and last send (HON-1084). In a deleted household, the manual members' rows (no account) go with it (`onDelete: Cascade` from `household`). Other members' rows are retained in retained households. |
| `household_preferences`             | household-shared                         | Deleted with the owned household (cascade); retained otherwise.                                                                                                                                                                                                                                                                                |
| `household_invite`                  | household-shared                         | Deleted with the owned household (cascade); retained otherwise.                                                                                                                                                                                                                                                                                |
| `member_preferences`                | personal (member-scoped)                 | **Deleted** with the user's membership (`onDelete: Cascade` from `household_member`), and with each manual member of a deleted household.                                                                                                                                                                                                      |
| `ingredient`                        | household-shared **or** global-reference | Household-scoped (`householdId` set) → deleted with the owned household. Global catalog rows (`householdId` null) → **retained**.                                                                                                                                                                                                              |
| `ingredient_translation`            | follows `ingredient`                     | Deleted with its ingredient (cascade); global ones retained.                                                                                                                                                                                                                                                                                   |
| `meal`                              | household-shared **or** global-reference | Household-scoped → deleted with the owned household; their generated image blobs (Vercel Blob, `meal.imageUrl`) are deleted by `purgeUser` after commit. Global meals (`householdId` null) → **retained**. (`meal.deletedAt` is an unrelated meal-level soft-delete.)                                                                          |
| `meal_translation`                  | follows `meal`                           | Deleted with its meal (cascade).                                                                                                                                                                                                                                                                                                               |
| `meal_component`                    | household-shared                         | Deleted with its meal (cascade).                                                                                                                                                                                                                                                                                                               |
| `favorite_meal`                     | household-shared                         | Deleted with the owned household (cascade).                                                                                                                                                                                                                                                                                                    |
| `meal_plan`                         | household-shared                         | Deleted with the owned household (cascade).                                                                                                                                                                                                                                                                                                    |
| `meal_plan_entry`                   | household-shared                         | Deleted with its meal plan (cascade).                                                                                                                                                                                                                                                                                                          |
| `pantry_item`                       | household-shared                         | Deleted with the owned household (cascade).                                                                                                                                                                                                                                                                                                    |
| `custom_shopping_item`              | household-shared                         | Deleted with the owned household (cascade).                                                                                                                                                                                                                                                                                                    |
| `ai_usage`                          | household-shared                         | Deleted with the owned household (`onDelete: Cascade` from `household`).                                                                                                                                                                                                                                                                       |

### Data held outside the database

| Store                    | What is keyed to the account                                                                                                                    | Fate on account purge                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostHog persons + events | The person identified by the user id (client `identify`, server errors), and the person for the household id (AI usage events attribute to it). | **Deleted** before the database transaction: the user id always, the household id when the purge deletes the household. Bulk delete with `delete_events: true`. A failed call (5xx, timeout, network error, or `deletion_errors` in the response) throws, so the user row stays and the next run retries. An unset `POSTHOG_PURGE_API_KEY`, or a key or project id PostHog rejects (401, 403, 404), skips with a captured error (see below). |
| Vercel Blob meal images  | The generated image of each meal in a deleted household (`meal.imageUrl`).                                                                      | **Deleted** after the transaction commits. Best effort with no retry: a failed delete is captured and swallowed, and leaves an image at a public URL nothing references any more.                                                                                                                                                                                                                                                            |

**PostHog persons purged while the purge key was unset or rejected.** With PostHog enabled and the key (or `POSTHOG_CLI_HOST` / `POSTHOG_CLI_PROJECT_ID`) missing, the purge still deletes the database data and captures one `POSTHOG_PURGE_API_KEY is not configured; PostHog person not purged` error per user. A key that is set but rejected (revoked, rotated, missing `person:write`) or a wrong project id does the same with `PostHog purge request rejected (status N); PostHog person not purged`; fix the key first, then sweep. Both errors carry the `user_id` property and a `distinct_ids` property listing every id that should have been deleted (the user id, plus the household ids the purge deleted, which are no longer in the database). Errors captured before HON-993 deployed carry the same values as `userId` and `distinctIds`, so read both names. Those errors are the list to sweep by hand: delete each person from the PostHog Persons page (with its events), or call `POST {POSTHOG_CLI_HOST}/api/projects/{POSTHOG_CLI_PROJECT_ID}/persons/bulk_delete/` with `{ "distinct_ids": [...], "delete_events": true }` and a personal API key with the `person:write` scope. Each environment has its own PostHog project, so sweep the project the errors were captured in. HON-869 owns doing the sweep once, after the key is provisioned.

**Households deleted by a leave (HON-1133).** A sole account holder who leaves their household (`POST /api/households/me/leave`, or "Leave and join" on an invite) deletes it, and `afterHouseholdLeft` in `src/lib/household-leave.ts` then deletes the household's PostHog person with the same `deletePosthogPersons` call. It runs after the database commit and does not block the leave. An unset or rejected key captures the errors above; any other failure captures the thrown error with `operation: 'posthog-household-purge'` and the household id in `distinct_ids`. Sweep both the same way.

> **Loud rule — keep these tables true.** When a new model stores user-owned or user-linked data, add it to `src/lib/auth/purge-user.ts` (if it isn't covered by an existing household cascade) **and** to the cascade table in the same PR. The same applies to a new store outside the database that keeps data keyed by the user or household id (a vendor, a bucket, a cache): delete it in `purgeUser` and add a row to "Data held outside the database". Same definition-of-done treatment as the privacy-policy processors table. (e.g. HON-453's per-user AI records, if not household-scoped.)

## Recovery procedure (within the grace window)

A user who changes their mind emails the privacy contact (`privacy@wobblepot.com`) before their purge date. To restore the account, the operator clears the two timestamps directly:

1. **Confirm the request is genuine.** Reply from the privacy inbox; verify the requester controls the account email. Do not restore on an unverified request.
2. **Restore the account** — run on the production database (read [`translation-maintenance.md`](translation-maintenance.md) § "Getting a SQL prompt" first if you are unsure how to reach a SQL prompt safely):

   ```sql
   -- Use the exact account email. Scoped to a soft-deleted row so a typo
   -- cannot touch an active account. Expect exactly 1 row updated.
   UPDATE "user"
   SET "deletedAt" = NULL,
       "purgeScheduledFor" = NULL
   WHERE email = 'user@example.com'
     AND "deletedAt" IS NOT NULL;
   ```

3. **Verify** `1 row` was updated. If `0 rows`, the account was either already purged (the window had elapsed — see below) or the email is wrong.
4. **Tell the user they must sign in again.** Their sessions were deleted at request time; their password still works once `deletedAt` is cleared. There is no automatic re-login.

**Timing:** recovery is only possible while the row still exists — i.e. before the daily 03:00 UTC cron runs on or after `purgeScheduledFor`. A request received on the purge date should be actioned the same day, before 03:00 UTC.

### If the account was already hard-purged

Once `purgeUser` has run, the row and its cascade are gone. The only recourse is point-in-time recovery from a database backup, and only within the backup window below. Follow [`database-recovery.md`](database-recovery.md) (PITR), and act fast — the window is short.

## Operator-initiated deletion

Use this when a verified requester ([`dsr-intake.md`](dsr-intake.md) § "Identity verification") cannot use Profile → "Delete account" themselves: they cannot sign in, or the sole-owner guard blocks them. The SQL does what `DELETE /api/auth/user` does, and the nightly cron then purges the account as usual. Every statement below runs on the production database; reach it as in [`translation-maintenance.md`](translation-maintenance.md) § "Getting a SQL prompt". Replace `user@example.com` with the exact account email everywhere.

1. **Check the sole-owner rule.** The route refuses when the user owns a household that another member **with an account** belongs to. Members without an account do not count (HON-881). List them:

   ```sql
   -- Other account holders in a household this user owns. Expect 0 rows.
   SELECT other."userId", u.email
   FROM "user" me
   JOIN household_member mine
     ON mine."userId" = me.id AND mine.role = 'owner'
   JOIN household_member other
     ON other."householdId" = mine."householdId"
    AND other."userId" IS NOT NULL
    AND other."userId" <> me.id
   JOIN "user" u ON u.id = other."userId"
   WHERE me.email = 'user@example.com';
   ```

   If this returns any rows, stop. Deleting the owner would leave those members in a household with no owner, and nothing in the app can transfer ownership. Handle the case individually with the requester (for example, the other members leave, or the owner removes them), and record what was agreed on the `privacy@` thread before running step 2.

2. **Soft-delete the account and sign it out everywhere**, in one transaction:

   ```sql
   BEGIN;

   -- purgeScheduledFor = the first 03:00 UTC run strictly after now + 30 days,
   -- the same instant computePurgeInstant (src/app/api/auth/user/route.ts)
   -- produces. The columns hold UTC without a time zone, hence AT TIME ZONE.
   -- Scoped to an active row: expect exactly 1 row updated.
   UPDATE "user"
   SET "deletedAt" = now() AT TIME ZONE 'UTC',
       "purgeScheduledFor" = (
         SELECT CASE WHEN c <= e THEN c + interval '1 day' ELSE c END
         FROM (
           SELECT e, date_trunc('day', e) + interval '3 hours' AS c
           FROM (SELECT (now() AT TIME ZONE 'UTC') + interval '30 days' AS e) AS t1
         ) AS t2
       )
   WHERE email = 'user@example.com'
     AND "deletedAt" IS NULL
   RETURNING id, "deletedAt", "purgeScheduledFor";

   DELETE FROM session
   WHERE "userId" = (SELECT id FROM "user" WHERE email = 'user@example.com');

   COMMIT;
   ```

   If the `UPDATE` reports `0` rows, nothing was scheduled: the email is wrong, or the account is already pending deletion (check its `"deletedAt"`). The `DELETE` is harmless either way.

3. **Reply on the thread with the purge date.** The route sends a confirmation email, but this SQL does not. Give the user the `purgeScheduledFor` value from `RETURNING` (a UTC time), and tell them they can cancel before then by writing to `privacy@wobblepot.com` ([Recovery procedure](#recovery-procedure-within-the-grace-window)).

## Immediate erasure (on written request)

The grace window exists for the user's protection, so a user may waive it. Do this only when the user asks in writing, on the `privacy@` thread, for deletion without the 30-day window. It is the one exception to "we never purge early" ([above](#why-purgescheduledfor-is-aligned-to-the-cron-run)).

Once purged, the account cannot be restored, except from a backup within the window in [Backup residuals](#backup-residuals-neon-pitr). Say so in the reply that confirms the request, before running anything.

1. If the account is not already pending deletion, run [Operator-initiated deletion](#operator-initiated-deletion) steps 1 and 2 first. That covers the sole-owner check and the sessions.
2. Bring the purge forward:

   ```sql
   -- Scoped to a pending row: expect exactly 1 row updated.
   UPDATE "user"
   SET "purgeScheduledFor" = now() AT TIME ZONE 'UTC'
   WHERE email = 'user@example.com'
     AND "deletedAt" IS NOT NULL
   RETURNING id, "deletedAt", "purgeScheduledFor";
   ```

3. Run the purge by hand ([Running the purge by hand](#running-the-purge-by-hand)), or let the next 03:00 UTC run take it.
4. Confirm the account is gone (`SELECT count(*) FROM "user" WHERE email = 'user@example.com';` returns 0), then reply on the thread with the date the data was deleted.

## Export during the grace window

Sign-in is blocked while `"deletedAt"` is set (`src/lib/auth/soft-delete-guard.ts`), and the export (`/api/auth/user/export`) needs a session. There is no operator-side export. Instead, lift the deletion briefly, let the user export, then put the deletion back as it was.

1. **Read the two timestamps:**

   ```sql
   SELECT "deletedAt", "purgeScheduledFor"
   FROM "user"
   WHERE email = 'user@example.com';
   ```

   Put both values in your reply on the thread ("you asked for deletion on …; it stays scheduled for …"). The thread is where they are recorded; step 4 puts them back from there.

2. **Clear them** with the `UPDATE` in [Recovery procedure](#recovery-procedure-within-the-grace-window) step 2.
3. **The user signs in and exports** from their profile. While the deletion is lifted, the account works normally, and the household's invites can be claimed again. Keep that window short, and finish before the recorded purge date: the cron skips an account whose `"deletedAt"` is cleared.
4. **Put the deletion back**, in one transaction. Re-run the query in [Operator-initiated deletion](#operator-initiated-deletion) step 1 first. If someone with an account joined while the deletion was lifted, it returns rows, and the case is handled as that step describes.

   ```sql
   BEGIN;

   -- The two values recorded in step 1, as written there (UTC).
   -- Scoped to an active row: expect exactly 1 row updated.
   UPDATE "user"
   SET "deletedAt" = '2026-09-01 10:00:00',
       "purgeScheduledFor" = '2026-10-02 03:00:00'
   WHERE email = 'user@example.com'
     AND "deletedAt" IS NULL
   RETURNING id, "deletedAt", "purgeScheduledFor";

   DELETE FROM session
   WHERE "userId" = (SELECT id FROM "user" WHERE email = 'user@example.com');

   COMMIT;
   ```

5. **Reply on the thread** that the export is done and the original purge date stands. If that date passed while the deletion was lifted, the next 03:00 UTC run purges the account.

## Checking the purge, and running it by hand

### Did it run?

```sql
-- Both counts are 0 after a successful run.
--   overdue:         past their purge instant but still present
--   never_scheduled: pending deletion with no purge instant, which the cron never selects
SELECT
  count(*) FILTER (WHERE "purgeScheduledFor" < now() AT TIME ZONE 'UTC') AS overdue,
  count(*) FILTER (WHERE "purgeScheduledFor" IS NULL)                     AS never_scheduled
FROM "user"
WHERE "deletedAt" IS NOT NULL;
```

Run it after 04:00 UTC. On Vercel's Hobby plan a `0 3 * * *` cron may fire at any point within the 03:00 hour. A non-zero `never_scheduled` count comes from hand-written SQL that set only `"deletedAt"`. Give the account a `"purgeScheduledFor"` (the expression in [Operator-initiated deletion](#operator-initiated-deletion) step 2).

**Vercel's record of the run:** in the project's **Settings → Cron Jobs**, select **View Logs** next to `/api/cron/purge-deleted-users`. This opens the runtime logs filtered by `requestPath`, with each invocation's status code ([Vercel: Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs#cron-jobs-logs)). Runtime logs are kept only for a limited time, so after that the SQL above is the check that remains.

### Running the purge by hand

The route is the same one the cron calls. Read `CRON_SECRET` from Vercel into a temporary file (never a bare `vercel env pull`, which writes `.env.local`), call the production host, and delete the file:

```bash
vercel env pull /tmp/wobblepot-prod.env --environment=production
CRON_SECRET="$(grep '^CRON_SECRET=' /tmp/wobblepot-prod.env | cut -d= -f2- | tr -d '"')"
rm -f /tmp/wobblepot-prod.env
curl -sS -H "Authorization: Bearer $CRON_SECRET" https://wobblepot.com/api/cron/purge-deleted-users
```

| Response                                | Meaning                                                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `200` `{"purged":n,"scanned":n}`        | `scanned` accounts were due. `purged` of them are gone. When `purged` is lower, the rest failed and are retried on the next run. |
| `401` `{"error":"Unauthorized"}`        | Wrong or empty secret. Check the pulled file had a `CRON_SECRET` line.                                                           |
| `500` `{"error":"Cron not configured"}` | `CRON_SECRET` is not set on production, so the scheduled run is failing too.                                                     |
| `500` `{"error":"Purge failed"}`        | The query for due accounts failed. The exception is in PostHog.                                                                  |

Running it twice is safe: a second run finds nothing due and returns `{"purged":0,"scanned":0}`.

### What reports a failure, and what does not

- **Reported:** each account that fails to purge is sent to PostHog error tracking through `captureApiError`, with `route: '/api/cron/purge-deleted-users'` and the `user_id` property. That includes a failed PostHog person delete, which leaves the account for the next run. So is a failed query for due accounts, a production deploy with no `CRON_SECRET`, and each account purged while the PostHog purge key is unset or rejected ([above](#data-held-outside-the-database)).
- **Not reported (known gap):** a run that never starts. Vercel's cron delivery is best effort and does not retry. A missed invocation leaves no runtime log, and the route never executes, so nothing reaches PostHog. The same applies if the cron is disabled in the dashboard, or if a rollback to a deployment without it removes it. The overdue query above is the only way to notice. Run it when you handle a deletion request, and after any change to `vercel.json` or the Vercel project.

## Backup residuals (Neon PITR)

The hard cascade removes data from the live database, but backup copies linger:

- **Neon Free plan: 24-hour PITR window.** Backup copies of purged data clear automatically within ~24 hours of the hard purge. After that, the data is irrecoverable from backups too — which is what makes the erasure complete for Art. 17 purposes.
- This 24-hour residual is disclosed in the privacy policy's retention schedule (HON-457).
- **If Neon moves to a paid plan** (HON-553), the PITR window lengthens (e.g. 7 days). When that lands, **update this note and the privacy policy retention text** so the published residual window stays accurate.

## Reference

- Soft-delete route: `src/app/api/auth/user/route.ts`
- Hard cascade: `src/lib/auth/purge-user.ts`
- PostHog person delete: `src/lib/posthog-purge.ts` (`POSTHOG_PURGE_API_KEY`: [`../ENVIRONMENT_SETUP.md`](../ENVIRONMENT_SETUP.md) § "PostHog")
- Sign-in block: `src/lib/auth/soft-delete-guard.ts` (wired in `src/lib/auth.ts` → `databaseHooks.session.create.before`)
- Purge cron: `src/app/api/cron/purge-deleted-users/route.ts` + `vercel.json`
- Confirmation email: `src/lib/emails/account-deletion-requested.ts`
- `CRON_SECRET` setup: [`../ENVIRONMENT_SETUP.md`](../ENVIRONMENT_SETUP.md) § "Cron secret"
- Cron invocation logs: [Vercel: Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs#cron-jobs-logs)
- PITR / rollback: [`database-recovery.md`](database-recovery.md)
