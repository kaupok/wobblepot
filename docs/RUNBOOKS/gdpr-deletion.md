# Account deletion runbook (GDPR Art. 17)

Operator reference for the 30-day grace-window account deletion flow (HON-481). GDPR Art. 17 (right to erasure) plus the privacy policy's published retention promise ("account data purged within 30 days of a deletion request") require that a user can request deletion, recover during a grace window, and be provably purged afterward. This runbook documents what gets deleted, the recovery procedure, and the backup residual window.

## Flow

```
User clicks "Delete account" (/profile → DeleteAccountDialog)
        │
        ▼
DELETE /api/auth/user
  • sole-owner-with-other-members guard (rejects; must transfer ownership first)
  • set user.deletedAt = now, user.purgeScheduledFor = first 03:00 UTC run
    at/after (now + 30 days)  ← the real deletion instant (see note below)
  • delete all sessions  → signed out everywhere
  • send confirmation email (states purge date + how to cancel)
        │
        ▼
[ 30-day grace window ]
  • sign-in blocked: databaseHooks.session.create.before throws a generic
    "Invalid email or password" (src/lib/auth/soft-delete-guard.ts)
  • household data + the user row remain intact
  • recovery = operator clears the two timestamps (see below)
        │
        ▼
Daily cron — 03:00 UTC (vercel.json → /api/cron/purge-deleted-users)
  • auth: Authorization: Bearer ${CRON_SECRET}
  • find users where deletedAt IS NOT NULL AND purgeScheduledFor < now
  • purgeUser(id) per user, each in its own transaction
        │
        ▼
Hard cascade complete → row gone → backup copies clear within ~24h (Neon PITR)
```

The hard cascade lives in `src/lib/auth/purge-user.ts` (`purgeUser`), shared by the cron. The soft-delete and the cron never run destructive SQL by hand — they use Prisma + the schema's `onDelete: Cascade` rules.

### Why `purgeScheduledFor` is aligned to the cron run

`purgeScheduledFor` is not a bare `now + 30 days`; it is the **first 03:00 UTC cron run at or after** that mark (`computePurgeInstant` in `route.ts`, keyed off `PURGE_CRON_UTC_HOUR`, which must match `vercel.json`). Two consequences:

- **The confirmation email's date is the real deletion date**, not an estimate that the once-daily cron then misses by a day.
- **The user always gets at least the full 30 days** to recover — we never purge early, because deletion is irreversible and erring toward keeping data is the safer failure.
- **Trade-off:** retention is therefore 30 days **plus up to one cron interval (≤24h)**. "Purged within 30 days" in the privacy policy (HON-457) should be read with that batch granularity in mind; tighten by running the cron more than once daily if a stricter bound is ever required. This is the deliberate product call from the HON-481 review — favour the recovery guarantee over a to-the-minute retention bound.

## Per-model cascade table

What happens to each model when a user account is purged. Classification:

- **personal** — belongs to the user alone; always deleted.
- **user-owned-household** — a household where the user is the owner **and** only member; the whole household is deleted.
- **household-shared** — data owned by a household; deleted **only** when its household is deleted (i.e. the user was the sole member). In a household with other members, the user leaves and this data is retained for them.
- **global-reference** — not owned by any single user; never deleted on account purge.

| Model (`table`)                     | Classification                           | Fate on account purge                                                                                                                                             |
| ----------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`                              | personal                                 | **Deleted** — the account row.                                                                                                                                    |
| `session`                           | personal                                 | **Deleted** — explicitly at soft-delete (sign-out) and again on user delete (`onDelete: Cascade`).                                                                |
| `account` (Better Auth credentials) | personal                                 | **Deleted** — `deleteMany` in the cascade + `onDelete: Cascade`. Password hashes go with it.                                                                      |
| `verification`                      | global-reference                         | **Not touched** — keyed by email/identifier, no FK to `user`. Pending rows self-expire (short TTL).                                                               |
| `signup_code`                       | global-reference (audit)                 | **Retained, unlinked** — `createdById` / `usedById` set to `NULL` (`onDelete: SetNull`). The code's usage history survives without pointing at a deleted user.    |
| `household`                         | user-owned-household                     | **Deleted** when the user is owner-and-only-member; **retained** otherwise.                                                                                       |
| `household_member`                  | personal (the membership)                | **Deleted** — the user's own membership (`onDelete: Cascade` from `user`). Other members' rows are retained in retained households.                               |
| `household_preferences`             | household-shared                         | Deleted with the owned household (cascade); retained otherwise.                                                                                                   |
| `household_invite`                  | household-shared                         | Deleted with the owned household (cascade); retained otherwise.                                                                                                   |
| `member_preferences`                | personal (member-scoped)                 | **Deleted** with the user's membership (`onDelete: Cascade` from `household_member`).                                                                             |
| `ingredient`                        | household-shared **or** global-reference | Household-scoped (`householdId` set) → deleted with the owned household. Global catalog rows (`householdId` null) → **retained**.                                 |
| `ingredient_translation`            | follows `ingredient`                     | Deleted with its ingredient (cascade); global ones retained.                                                                                                      |
| `meal`                              | household-shared **or** global-reference | Household-scoped → deleted with the owned household. Global meals (`householdId` null) → **retained**. (`meal.deletedAt` is an unrelated meal-level soft-delete.) |
| `meal_translation`                  | follows `meal`                           | Deleted with its meal (cascade).                                                                                                                                  |
| `meal_component`                    | household-shared                         | Deleted with its meal (cascade).                                                                                                                                  |
| `favorite_meal`                     | household-shared                         | Deleted with the owned household (cascade).                                                                                                                       |
| `meal_plan`                         | household-shared                         | Deleted with the owned household (cascade).                                                                                                                       |
| `meal_plan_entry`                   | household-shared                         | Deleted with its meal plan (cascade).                                                                                                                             |
| `pantry_item`                       | household-shared                         | Deleted with the owned household (cascade).                                                                                                                       |
| `custom_shopping_item`              | household-shared                         | Deleted with the owned household (cascade).                                                                                                                       |
| `ai_usage`                          | household-shared                         | Deleted with the owned household (`onDelete: Cascade` from `household`).                                                                                          |

> **Loud rule — keep this table true.** When a new model stores user-owned or user-linked data, add it to `src/lib/auth/purge-user.ts` (if it isn't covered by an existing household cascade) **and** to this table in the same PR. Same definition-of-done treatment as the privacy-policy processors table. (e.g. HON-453's per-user AI records, if not household-scoped.)

## Recovery procedure (within the grace window)

A user who changes their mind emails the privacy contact (`privacy@wobblepot.com`) before their purge date. To restore the account, the operator clears the two timestamps directly:

1. **Confirm the request is genuine.** Reply from the privacy inbox; verify the requester controls the account email. Do not restore on an unverified request.
2. **Restore the account** — run on the production database (read [`database-recovery.md`](database-recovery.md) first if you are unsure how to reach a SQL prompt safely):

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

## Backup residuals (Neon PITR)

The hard cascade removes data from the live database, but backup copies linger:

- **Neon Free plan: 24-hour PITR window.** Backup copies of purged data clear automatically within ~24 hours of the hard purge. After that, the data is irrecoverable from backups too — which is what makes the erasure complete for Art. 17 purposes.
- This 24-hour residual is disclosed in the privacy policy's retention schedule (HON-457).
- **If Neon moves to a paid plan** (HON-553), the PITR window lengthens (e.g. 7 days). When that lands, **update this note and the privacy policy retention text** so the published residual window stays accurate.

## Reference

- Soft-delete route: `src/app/api/auth/user/route.ts`
- Hard cascade: `src/lib/auth/purge-user.ts`
- Sign-in block: `src/lib/auth/soft-delete-guard.ts` (wired in `src/lib/auth.ts` → `databaseHooks.session.create.before`)
- Purge cron: `src/app/api/cron/purge-deleted-users/route.ts` + `vercel.json`
- Confirmation email: `src/lib/emails/account-deletion-requested.ts`
- `CRON_SECRET` setup: [`../ENVIRONMENT_SETUP.md`](../ENVIRONMENT_SETUP.md) § "Cron secret"
- PITR / rollback: [`database-recovery.md`](database-recovery.md)
