# Database recovery runbook

Migration rollback and point-in-time recovery (PITR) procedures.

## Why this exists

`scripts/maybe-migrate.sh` handles forward migrations safely. When one lands bad data, there is no `down` migration to run and no team lead to page — there is one operator, at whatever time of day the bad migration went live. This runbook is what that operator executes, step by step, without interpretation.

The approach: **Neon branching + fix-forward migrations, always**. Never destructive SQL on staging or production. Branch from a point-in-time snapshot, validate the fix on the branch, then apply the fix forward on `main`.

## Policy: never destructive on staging or production

From [`CLAUDE.md`](../../CLAUDE.md):

> **Never run destructive database commands (`migrate reset`, `db push --force-reset`, `DROP`, etc.) on staging or production.** These destroy real data. Always ask the user before taking any destructive action on shared environments — even to fix migration issues. Prefer `migrate resolve` or manual SQL fixes instead.

Every procedure below respects that rule. Specifically, on staging and production we do not run:

- `prisma migrate reset` / `pnpm db:push --force-reset`
- `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, or any `DELETE` without a `WHERE` clause
- Any migration whose net effect destroys data that is not already backed up on a recovery branch

If a recovery step seems to require one of the above, stop and re-read this runbook — there is always a non-destructive path.

## Plan baseline: Neon Free (24-hour PITR)

We are on **Neon Free**. That gives us:

- **24-hour PITR window** — any timestamp within the last 24 hours is restorable as a new branch.
- **Automatic history** — no manual snapshot action required.
- **Branching** — copy-on-write, near-instant.

**24h is the floor, not the ceiling.** If we upgrade to Neon Pro, PITR extends to 7 or 14 days and this runbook's timing assumptions become more forgiving. Nothing in the procedures below needs to change — only the allowable incident-detection lag widens.

If an incident is discovered **more than 24 hours** after it occurred on Free tier, the PITR window is gone. In that case: stop this runbook, rebuild from the latest clean staging branch + `pnpm db:seed`, and note that any user data written in the missing window is not recoverable. Document in the incident log.

## Forward-only migration philosophy

We **do not write reversible `down` migrations**. Recovery is always fix-forward:

1. Write a new migration that corrects the bad state.
2. Validate it on a Neon branch created from just before the incident.
3. Once the branch shows the migration repairs state correctly, apply the same migration to `main`.

This avoids the whole class of bug where a `down` migration has its own bugs and makes things worse mid-incident. A broken `down` at 2am is worse than the original problem.

## Neon branching recovery workflow

These steps are generic; the failure-mode playbooks below reference them.

### Prerequisites

- `NEON_API_KEY` exported locally (see [`docs/ENVIRONMENT_SETUP.md`](../ENVIRONMENT_SETUP.md)).
- `NEON_PROJECT_ID` exported locally (same).
- `neonctl` invoked via `pnpm dlx neonctl@2.22.0` — no install step.

### Steps

1. **Identify the "last known good" timestamp.** Usually: the last deploy that passed smoke tests. Look at `gh run list --workflow deploy-code-production.yml` or the Vercel deployments list. Pick an ISO-8601 timestamp a minute _before_ the bad deploy finished. Example: `2026-04-20T08:42:00Z`.

2. **Create a recovery branch from that timestamp:**

   ```bash
   pnpm dlx neonctl@2.22.0 branches create \
     --project-id "$NEON_PROJECT_ID" \
     --parent main \
     --name "recovery-$(date +%Y%m%d-%H%M)" \
     --parent-timestamp "2026-04-20T08:42:00Z"
   ```

   Neon responds with the new branch's ID. Note it.

3. **Retrieve the branch connection strings:**

   ```bash
   pnpm dlx neonctl@2.22.0 connection-string recovery-YYYYMMDD-HHMM \
     --project-id "$NEON_PROJECT_ID" --pooled
   pnpm dlx neonctl@2.22.0 connection-string recovery-YYYYMMDD-HHMM \
     --project-id "$NEON_PROJECT_ID"
   ```

   Export the unpooled one as `DATABASE_URL_UNPOOLED` and the pooled one as `DATABASE_URL` in a scratch shell. Do **not** overwrite `.env`.

4. **Validate branch state.** Confirm the branch is in the expected pre-incident shape:
   - Row counts for critical tables:

     ```bash
     psql "$recovery_pooled" -c '
       SELECT
         (SELECT COUNT(*) FROM "user")      AS users,
         (SELECT COUNT(*) FROM household)    AS households,
         (SELECT COUNT(*) FROM meal_plan)    AS meal_plans;'
     ```

   - Spot-check a handful of specific rows you know were affected (e.g. the user who reported the bug).

5. **Apply the fix.** There are two patterns — pick one:

   **Pattern A — Corrective migration.** Write a new Prisma migration that repairs state. Validate on the recovery branch:

   ```bash
   DATABASE_URL="$recovery_pooled" \
   DATABASE_URL_UNPOOLED="$recovery_unpooled" \
   pnpm db:migrate:deploy
   ```

   Re-run the validation queries from step 4. If state is correct, apply the same migration to `main` via the normal production-deploy workflow (`deploy-db-migrations-production.yml`).

   **Pattern B — Targeted row re-insert.** Export the affected rows from the recovery branch, then apply a narrow `UPDATE` or `INSERT` to `main` scoped to those IDs. Always wrap in `BEGIN;` / `COMMIT;`. Example:

   ```sql
   -- Run against recovery branch
   COPY (SELECT * FROM meal_plan WHERE id IN ('...')) TO STDOUT WITH CSV HEADER;
   -- Then on main, in a transaction:
   BEGIN;
   INSERT INTO meal_plan (...) VALUES (...);
   COMMIT;
   ```

### Do not promote the recovery branch

Promoting a branch swaps the entire database. Any valid user data written _after_ the incident timestamp on `main` would be lost. **We never promote.** The recovery branch is a read-only reference until it is deleted.

The automated cleanup in [`neon-branch-gc.md`](neon-branch-gc.md) only reaps `auto--hon-*` branches, **not** `recovery-*` — so cleanup is manual:

```bash
pnpm dlx neonctl@2.22.0 branches delete recovery-YYYYMMDD-HHMM \
  --project-id "$NEON_PROJECT_ID"
```

Delete the recovery branch only after the incident is resolved and post-mortem notes are filed. Until then, keep it — the branch cap on Neon Free (10 endpoints) is high enough that one extra branch during an active incident is not a concern.

## Failure-mode playbooks

One subsection per mode. Each starts with what it looks like, then the numbered recovery steps.

### 1. `NOT NULL` column with wrong or incomplete backfill

**Symptoms:** `pnpm db:migrate:deploy` succeeded but app reports null-constraint errors; or the app runs but certain rows show placeholder/wrong values in the new column.

1. Execute the Neon branching workflow above. Use a timestamp from immediately before the migration ran.
2. On the recovery branch, inspect the _original_ values the backfill should have produced. If the backfill logic lived in the migration SQL, you need to derive the correct values from joined tables.
3. Write a new corrective migration: update the column values on `main` based on the correct derivation. Use `UPDATE` scoped to affected IDs, not a blanket `UPDATE` of every row.
4. Validate on the recovery branch first (Pattern A above). Confirm the rows now match what the original backfill intended.
5. Apply the corrective migration to `main` via the production-deploy workflow.
6. Monitor (see section below).

### 2. Migration dropped a column or table still referenced by code

**Symptoms:** 5xx errors from the app after a deploy; errors reference a column or table that no longer exists. (This should be caught by CI — if it reached production, also file a follow-up issue to tighten pre-deploy validation.)

1. Roll back **code** immediately via Vercel dashboard → Deployments → Promote previous deployment to Production. This buys time.
2. Execute the Neon branching workflow. Use a timestamp from before the dropped-column migration.
3. On the recovery branch, export the column/table data:

   ```bash
   # Single column
   psql "$recovery_unpooled" -c "COPY (SELECT id, <dropped_column> FROM \"<table>\") TO STDOUT WITH CSV HEADER" > dropped.csv

   # Whole table
   pg_dump "$recovery_unpooled" --table="<table>" --data-only > dropped.sql
   ```

4. Write a **new forward migration** that re-adds the column/table structure.
5. Validate the migration on the recovery branch, then apply to `main`.
6. Re-insert the exported data into `main` in a transaction (Pattern B above).
7. Re-deploy the code (the version that assumed the column exists).
8. Monitor.

### 3. Cascade delete destroyed live rows

**Symptoms:** Users report missing meal plans / households / recipes. Row counts for a table dropped dramatically between two deploys. (The soft-delete path introduced by [HON-481](https://linear.app/honkadori/issue/HON-481) is designed to prevent this; if cascade deletion still reaches this runbook, file a follow-up to tighten the soft-delete coverage.)

1. Execute the Neon branching workflow. Use a timestamp from before the cascade ran.
2. On the recovery branch, identify the affected rows and their dependent records:

   ```sql
   SELECT * FROM meal_plan WHERE "householdId" = '<affected_household_id>';
   SELECT * FROM meal_plan_entry WHERE "planId" IN (...);
   ```

3. Export the affected rows + all dependent records (meal plans, entries, pantry items — whatever cascaded).
4. Re-insert into `main` **in a single transaction** (`BEGIN; ... COMMIT;`) in the correct foreign-key order (parents first, then children). Use the original primary keys so downstream references still resolve.
5. Verify row counts on `main` match the recovery branch for the affected scope.
6. Monitor. Verify the affected users can see their data in-app.

### 4. Seed or migration script corrupted data values

**Symptoms:** Data looks wrong for many users (e.g. all ingredients show the same name; all meal plans have the same start date). Often from a seed script that ran against a non-empty DB, or a migration with a buggy `UPDATE`.

1. Execute the Neon branching workflow. Timestamp: before the corrupting script ran.
2. On the recovery branch, diff the corrupted column(s) against the known-good state:

   ```sql
   -- Example: find ingredient rows whose name looks suspect
   SELECT id, name FROM ingredient WHERE name = '<suspect_placeholder>';
   ```

3. Export the correct values with their primary keys.
4. Write a targeted `UPDATE` on `main`, scoped to the affected IDs, restoring the correct values. Wrap in a transaction.
5. Re-run the diff after the fix to confirm no rows remain corrupted.
6. Monitor.

## Monitoring after recovery

After any recovery, confirm the fix held and nothing new broke:

1. **Vercel runtime logs.** Watch for 5xx errors tied to the recovered state for at least 30 minutes.
2. **Row counts** for the critical tables — `User`, `Household`, `MealPlan`. Compare against pre-incident counts (pulled from the recovery branch) to spot unexpected drift.
3. **User-visible flows.** Manually sign in as a test user and walk through the flows that were affected. For meal-plan recoveries, confirm the affected household's current meal plan loads.
4. **Linear post-mortem issue.** File within 24 hours describing the incident, timeline, recovery steps taken, and a follow-up task to prevent recurrence.

### Escalation: corrupted or exposed personal data

If the incident involved **personal data being corrupted or exposed** (not just broken, but _disclosed_ to the wrong party or _modified_ in ways users could not have expected), it may trigger GDPR Art. 33 (72-hour supervisory-authority notification) or Art. 34 (notifying affected users).

Escalate immediately via [`docs/RUNBOOKS/breach-notification.md`](breach-notification.md) (landing with [HON-482](https://linear.app/honkadori/issue/HON-482)). The 72-hour clock starts on _awareness_, not on full investigation. Do not wait to finish this runbook before starting the breach process — they run in parallel.

## Quarterly restore drill

Every quarter, run a tabletop drill of this runbook:

1. Pick a recent migration that is at least a week old.
2. Create a Neon branch from a timestamp immediately before it ran.
3. Walk through the Neon branching recovery workflow end-to-end on that branch, as if it were a live incident. You do not need to apply anything to `main` — the point is to exercise the runbook and find gaps.
4. Time the exercise. **Target: under 30 minutes from "pick timestamp" to "validated fix on recovery branch."**
5. Log the outcome in the drill table below. Update the runbook to close any gaps found.
6. Delete the recovery branch when done.

If a drill takes longer than 30 minutes, the runbook has a gap. Fix it.

### Drill log

| Date       | Migration targeted                    | Scenario simulated                                                                                                                                                                            | Time to recovery | Pass/fail | Notes                                                                                                                                                                                                                                                                                                    |
| ---------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-20 | `20260420090000_add_ai_usage_and_cap` | Paper walkthrough: `NOT NULL`-column backfill recovery (playbook #1). Traced each step without executing live `neonctl` commands, since this is the seed drill written alongside the runbook. | ~20 min          | Pass      | Initial drill performed while landing HON-473. No gaps surfaced in the workflow; command snippets and step ordering read clean under simulated 2am pressure. Next drill should be a _live_ exercise against a real recovery branch to exercise the `neonctl` commands and validation queries end-to-end. |

## Related

- [`docs/DEPLOYMENT.md`](../DEPLOYMENT.md) — standard forward deploys.
- [`CLAUDE.md`](../../CLAUDE.md) — destructive-command policy (single source of truth).
- [`docs/RUNBOOKS/neon-branch-gc.md`](neon-branch-gc.md) — automated cleanup of `auto--hon-*` branches (related safety system).
- [`docs/RUNBOOKS/breach-notification.md`](breach-notification.md) — escalation when personal data is corrupted or exposed ([HON-482](https://linear.app/honkadori/issue/HON-482), lands after this runbook).
- [`docs/ENVIRONMENT_SETUP.md`](../ENVIRONMENT_SETUP.md) — where `NEON_API_KEY` / `NEON_PROJECT_ID` come from.
- [HON-481](https://linear.app/honkadori/issue/HON-481) — account deletion cascade (soft-delete path that reduces the risk of playbook #3).
- [HON-473](https://linear.app/honkadori/issue/HON-473) — this runbook's tracking issue.
