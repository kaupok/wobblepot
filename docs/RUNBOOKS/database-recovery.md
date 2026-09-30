# Database recovery runbook

Migration rollback and point-in-time recovery (PITR) procedures.

## Why this exists

Forward migrations are applied by `deploy-db-migrations-staging.yml` and `deploy-db-migrations-production.yml` (`scripts/maybe-migrate.sh` covers preview deploys only). When one lands bad data, there is no `down` migration to run and no team lead to page — there is one operator, at whatever time of day the bad migration went live. This runbook is what that operator executes, step by step, without interpretation.

The approach: **Neon branching + fix-forward migrations, always**. Never destructive SQL on staging or production. Branch from a point-in-time snapshot, validate the fix on the branch, then apply the fix forward on `main`.

## Policy: never destructive on staging or production

From [`CLAUDE.md`](../../CLAUDE.md) → Database Patterns:

> **Destructive commands:** do not run `migrate reset`, `db push --force-reset`, `DROP` or similar against staging or production. They destroy real data. Ask the user before any destructive action on a shared environment, even to fix a migration problem, and prefer `migrate resolve` or a manual SQL fix.

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

2. **Create a recovery branch from that timestamp.** `neonctl@2.22.0`'s `branches create` exposes exactly one parent flag — `--parent` — which accepts a branch name, branch ID, timestamp, or LSN. Pass the incident timestamp directly as `--parent` and the CLI performs PITR from the default branch (our `main`):

   ```bash
   recovery_branch="recovery-$(date +%Y%m%d-%H%M)"
   pnpm dlx neonctl@2.22.0 branches create \
     --project-id "$NEON_PROJECT_ID" \
     --parent "2026-04-20T08:42:00Z" \
     --name "$recovery_branch"
   ```

   Neon responds with the new branch's ID. Note it.

   **Caveat:** this shape only works because production lives on Neon's default branch. If the primary DB is ever moved to a non-default branch, `neonctl` cannot express both a non-default parent _and_ a point-in-time — we would need to drop to the API (`POST /projects/:id/branches` with `parent_id` + `parent_timestamp`). Flag this when the branch layout changes.

   **If it fails with `branches limit exceeded`,** the project is at the Neon Free cap of 10 branches. Expect this: three orchestrator workers budget 9 of the 10 ([`docs/PARALLEL_WORKFLOW.md`](../PARALLEL_WORKFLOW.md) → Branch budget), and the project sat at 10 of 10 on 2026-09-29. The recovery branch outranks every issue and preview branch, so free one and re-run the command above:
   1. Stop whatever would take the freed branch: `wt stop` if the orchestrator is running, and any `pnpm review:local` or `pnpm test:e2e:local` (each holds an `e2e-local-*` branch until it exits, which frees it).
   2. See what holds the cap:

      ```bash
      pnpm dlx neonctl@2.22.0 branches list --project-id "$NEON_PROJECT_ID"
      ```

   3. Free branches in this order, re-running `branches create` after each:
      - **Orphans.** Run the sweep by hand with the age gate off ([`neon-branch-gc.md`](neon-branch-gc.md) → Triggering manually: dry run first, then `NEON_CLEANUP_DRY_RUN=0 NEON_CLEANUP_MIN_AGE_HOURS=0 ./scripts/neon-cleanup.sh sweep`). It deletes `preview/*` branches whose git ref and PR are gone, and `*--hon-*` branches whose issue is Done or Canceled.
      - **Worker branches.** For a stranded run (listed by `wt list`; its PR is pushed), `wt cleanup <git-branch>` removes the worktree and its Neon branch. A `*--hon-*` branch with no worktree, such as one a `wt stop` drain kept for the next run, goes directly: `pnpm dlx neonctl@2.22.0 branches delete "<name>" --project-id "$NEON_PROJECT_ID"`. The next run on that issue forks a fresh one from `staging`.
      - **Last resort: a live PR's `preview/<git-branch>`.** `pnpm dlx neonctl@2.22.0 branches delete "preview/<git-branch>" --project-id "$NEON_PROJECT_ID"`. That PR's preview deployment then fails with `P1001` (the HON-492 failure) until it is redeployed after the incident.

   Never delete `main` (production), `staging`, `dev/kaupo` or `vercel-dev`.

3. **Retrieve the branch connection strings:**

   ```bash
   pnpm dlx neonctl@2.22.0 connection-string "$recovery_branch" \
     --project-id "$NEON_PROJECT_ID" --pooled
   pnpm dlx neonctl@2.22.0 connection-string "$recovery_branch" \
     --project-id "$NEON_PROJECT_ID"
   ```

   Export the pooled one as `DATABASE_URL` and the unpooled one as `DATABASE_URL_UNPOOLED` in a **scratch shell** — do not overwrite `.env`. `pnpm db:migrate:deploy` reads `DATABASE_URL_UNPOOLED` from the environment (`prisma.config.ts`). `psql` and `pg_dump` do not read either variable — pass `"$DATABASE_URL"` explicitly, as the commands below do.

4. **Validate branch state.** Confirm the branch is actually pre-incident, not a silent fork of current `main`:
   - Row counts for critical tables:

     ```bash
     psql "$DATABASE_URL" -c '
       SELECT
         (SELECT COUNT(*) FROM "user")    AS users,
         (SELECT COUNT(*) FROM household) AS households,
         (SELECT COUNT(*) FROM meal_plan) AS meal_plans;'
     ```

   - Newest writes the app makes in normal use: `session."createdAt"` is set on every sign-in, `ai_usage."createdAt"` on every AI call.

     ```bash
     psql "$DATABASE_URL" -c '
       SELECT
         (SELECT MAX("createdAt") FROM session)  AS last_sign_in,
         (SELECT MAX("createdAt") FROM ai_usage) AS last_ai_call;'
     ```

   - **Gate against a broken recovery branch.** Compare the counts against what you expect _before_ the incident, and check that neither timestamp is later than the `--parent` timestamp (after a quiet night both can be hours earlier; that is fine). If either timestamp is later, or the counts look like current post-incident state, stop — the `--parent` timestamp was misread by Neon, or the flag was silently ignored by a newer CLI version. Do not proceed to step 5; re-create the branch with a different timestamp format or fall back to the Neon console (Branches → Create branch → "At a point in time").
   - Spot-check a handful of specific rows you know were affected (e.g. the user who reported the bug).

5. **Apply the fix.** There are two patterns — pick one:

   **Pattern A — Corrective migration.** Write a new Prisma migration that repairs state. It reaches production only through `main`, and it is frozen once it gets there, so take these in order:
   1. **Get it right on the recovery branch.** Apply it there (the scratch-shell `DATABASE_URL` / `DATABASE_URL_UNPOOLED` from step 3 already point at it) and re-run the validation queries from step 4:

      ```bash
      pnpm db:migrate:deploy
      ```

      This is the last point at which the SQL can change. Once it merges, the immutability check freezes its bytes (CLAUDE.md → Database Patterns → Migration immutability), and a mistake found later costs a second corrective migration. A branch that applied it will not apply an edited version, so to try a changed file, delete the recovery branch and create a new one from the same timestamp (step 2).

   2. **Merge it to `main` by PR, and let staging apply it first.** Both migration workflows check out the repository's default branch, so a migration that is only on a feature branch reaches neither database. The merge's push runs `deploy-db-migrations-staging.yml`, which applies it to staging. Confirm that run is green and the repair shows on staging before you go on.
   3. **Then production.** Dispatch `deploy-db-migrations-production.yml` (`gh workflow run deploy-db-migrations-production.yml`). It runs `prisma migrate deploy` and then `pnpm db:seed`, so the seed runs against the repaired state. If the repair touches what `prisma/seed.ts` writes (the global meal and ingredient pool, their translations, the seeded test users), check that the seed will not write the old values back.

   **Pattern B — Targeted row re-insert.** Export the affected rows from the recovery branch, then apply a narrow `UPDATE` or `INSERT` to `main` scoped to those IDs. Always wrap in `BEGIN;` / `COMMIT;`. Example:

   ```sql
   -- Run against recovery branch: psql "$DATABASE_URL" (the scratch-shell value from step 3)
   COPY (SELECT * FROM meal_plan WHERE id IN ('...')) TO STDOUT WITH CSV HEADER;
   -- Then on main (a separate psql session on the production connection string), in a transaction:
   BEGIN;
   INSERT INTO meal_plan (...) VALUES (...);
   COMMIT;
   ```

### Do not promote the recovery branch

Promoting a branch swaps the entire database. Any valid user data written _after_ the incident timestamp on `main` would be lost. **We never promote.** The recovery branch is a read-only reference until it is deleted.

The automated cleanup in [`neon-branch-gc.md`](neon-branch-gc.md) only reaps issue branches (`<prefix>--hon-<N>[-slug]`) and orphaned `preview/*` branches, **not** `recovery-*` — so cleanup is manual:

```bash
pnpm dlx neonctl@2.22.0 branches delete "$recovery_branch" \
  --project-id "$NEON_PROJECT_ID"
```

Delete the recovery branch only after the incident is resolved and post-mortem notes are filed. Until then, keep it. It holds one of the project's 10 branches; if creating it hit the cap, step 2 says what to free.

## Failure-mode playbooks

One subsection per mode. Each starts with what it looks like, then the numbered recovery steps.

### 1. `NOT NULL` column with wrong or incomplete backfill

**Symptoms:** `pnpm db:migrate:deploy` succeeded but app reports null-constraint errors; or the app runs but certain rows show placeholder/wrong values in the new column.

1. Execute the Neon branching workflow above. Use a timestamp from immediately before the migration ran.
2. On the recovery branch, inspect the _original_ values the backfill should have produced. If the backfill logic lived in the migration SQL, you need to derive the correct values from joined tables.
3. Write a new corrective migration: update the column values on `main` based on the correct derivation. Use `UPDATE` scoped to affected IDs, not a blanket `UPDATE` of every row.
4. Validate on the recovery branch first (Pattern A above). Confirm the rows now match what the original backfill intended.
5. Apply the corrective migration to staging, then production (Pattern A, steps 2 and 3).
6. Monitor (see section below).

### 2. Migration dropped a column or table still referenced by code

**Symptoms:** 5xx errors from the app after a deploy; errors reference a column or table that no longer exists. (This should be caught by CI — if it reached production, also file a follow-up issue to tighten pre-deploy validation.)

1. Roll back **code** immediately via Vercel dashboard → Deployments → Promote previous deployment to Production. This buys time.
2. Execute the Neon branching workflow. Use a timestamp from before the dropped-column migration.
3. On the recovery branch, export the column/table data (`DATABASE_URL_UNPOOLED` from step 3 of the workflow points here):

   ```bash
   # Single column
   psql "$DATABASE_URL_UNPOOLED" -c "COPY (SELECT id, <dropped_column> FROM \"<table>\") TO STDOUT WITH CSV HEADER" > dropped.csv

   # Whole table
   pg_dump "$DATABASE_URL_UNPOOLED" --table="<table>" --data-only > dropped.sql
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

### 5. Migration failed to apply (or applied halfway)

The only failure mode on record, twice: `20260116200000_simplify_meal_statuses` (PR #180, fixed by #181) and `20260215121900_remove_omnivore_dietary_type` (#346, fixed by #356). Both failed on staging and never reached production.

**Symptoms:** the `Deploy migrations [staging]` or `Deploy migrations [production]` step fails. `pnpm prisma migrate status` against that database reports a failed migration and prints both `migrate resolve` commands. Every later deploy there stops with `P3009` (`migrate found failed migrations in the target database, new migrations will not be applied`), so no migration reaches that database until this one is resolved. Code that expects the new schema fails at runtime.

**Assume it applied halfway.** Prisma 7's `migrate deploy` does not wrap a migration in a transaction. It runs `migration.sql` one statement at a time and each statement commits as it runs, so every statement in the file runs outside a transaction. When one fails, the statements above it are applied, it is not (a single statement is atomic), and nothing below it ran. This was checked against Prisma 7.10.0 for HON-865, and it matches January: the #181 recovery had to drop a `"MealPlanEntryStatus_new"` type left behind by #180. The prisma.io pages that say a failed run "leaves nothing behind" describe Prisma 8's `db migrate`, not the `migrate deploy` this project runs.

1. **Contain it.** Do not dispatch `deploy-db-migrations-production.yml` while staging is failing: production would fail the same way. Hold merges that add migrations; they cannot apply. If production already failed, run the steps below for staging first, then for production.
2. **Connect to the failed database in a scratch shell.** Get its connection strings as in step 3 of the workflow, with branch `staging` or `main` (production) in place of `"$recovery_branch"`, and export `DATABASE_URL` and `DATABASE_URL_UNPOOLED`. The `prisma` commands below act on whatever `DATABASE_URL_UNPOOLED` points at (`prisma.config.ts`), so check it before each one.
3. **Read the failure:**

   ```bash
   psql "$DATABASE_URL_UNPOOLED" -c '
     SELECT migration_name, started_at, logs
     FROM _prisma_migrations
     WHERE finished_at IS NULL AND rolled_back_at IS NULL;'
   ```

   `logs` holds the Postgres error. Match it to a statement in `prisma/migrations/<migration_name>/migration.sql`: every statement above that one applied; that one and everything below it did not.

4. **Confirm what applied.** For each statement above the failing one, check the result on the database: `\d <table>` for a table change, `\dT+ "<EnumName>"` for a type, a `SELECT` of the target rows for an `UPDATE`. Write down each one as applied or not. #180 failed after a `CREATE TYPE` that applied; #346 failed on its first statement, so nothing applied.
5. **Decide which is wrong, the SQL or the data.** That picks the `resolve` form:
   - **The SQL is wrong,** and it would fail on any database: a syntax error, a Prisma model name where the `@@map` table name belongs (#346), a cast Postgres cannot make (#180). Use **`--rolled-back`** (step 6).
   - **The SQL is right, and this database's data made it fail,** e.g. a `NOT NULL` column or unique index added over rows that violate it. Typically it applied cleanly on seeded databases (CI, preview branches) and failed only here. Use **`--applied`** (step 7).
6. **`--rolled-back`: undo, fix the file, re-deploy.**
   1. Undo each statement step 4 marked as applied, in reverse order, in one transaction, for example `BEGIN; DROP TYPE "MealPlanEntryStatus_new"; COMMIT;`. Drop only what the failed migration itself created. An agent asks the user before running this, as for any destructive command on a shared database. An `UPDATE` that applied can stay if the fixed file will run it again to the same result. If it overwrote values the fixed file will not restore, restore them from a recovery branch (Pattern B).
   2. Fix `migration.sql` in place on a branch off `main`, and make it reach `main` the way step 8 describes.
   3. Validate the fixed file against real data. Create a branch of the failed database, which has been undone by now: the command in step 2 of the workflow, with `--parent staging` (or `--parent main` for production) in place of the timestamp. Point the scratch shell at it (step 3 of the workflow). From the fix branch's checkout, run `pnpm prisma migrate resolve --rolled-back <migration_name>` and then `pnpm db:migrate:deploy`, and check the result as in step 4. Delete the branch afterwards, then point the scratch shell back at the failed database.
   4. Merge the fix. The push's staging run fails again with `P3009` and applies nothing, which is expected.
   5. On the failed database: `pnpm prisma migrate resolve --rolled-back <migration_name>`. This marks the failed row rolled back, so the next deploy runs the migration again from the file.
   6. Re-apply. For staging, run `gh workflow run deploy-db-migrations-staging.yml` (a dispatch also re-seeds staging). For production, dispatch `deploy-db-migrations-production.yml` once staging is green. After each run, `pnpm prisma migrate status` reports the database up to date.

   Do not reset. #356 recovered staging with `migrate reset --force`, which the destructive-command policy above now forbids; step 6 is the path that replaces it.

7. **`--applied`: fix the data, finish by hand, record it.** The file does not change, so nothing has to reach `main`.
   1. Fix the offending rows in a transaction, scoped by ID (Pattern B), for example by backfilling the `NULL`s or resolving the duplicates. If the right values are not derivable, take them from a recovery branch.
   2. Run the statements that did not apply, the failing one and everything below it, **exactly as written** in `migration.sql`, in one transaction. `--applied` records the checksum of the file as it is, so the database has to end up where the file would have put it. A variant leaves it drifted from every database that ran the file.
   3. From a checkout of `main`, run `pnpm prisma migrate resolve --applied <migration_name>`. It records the checksum of the `migration.sql` in your checkout, so that file must be byte-identical to `main`'s. `pnpm prisma migrate status` then reports the database up to date.
   4. Re-run the failed workflow so the migrations behind it apply: `gh workflow run deploy-db-migrations-staging.yml`, or `deploy-db-migrations-production.yml` for production. Before dispatching production, check its data for the same violation with a `SELECT`, and fix it first the same way.
8. **Getting a fixed migration to `main` (step 6 only).** The fix edits a migration that is already on `main`, which the immutability check exists to stop. The edit is safe only because no database holds the old bytes as applied: the failed row's checksum is set aside by `resolve --rolled-back`. The project's path is **edit in place plus an allowlist pin, in one PR**, as #181 and #356 did (their pins are the two entries in `scripts/migration-immutability-allowlist.txt`):
   1. Confirm the migration finished nowhere: on staging and on production, `SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name = '<migration_name>';` returns no row with `finished_at` set. If one does, the migration applied there, and editing it creates exactly the drift the check guards against. Go back to step 5: that database needs `--applied` or a new corrective migration, not an edit.
   2. Edit `prisma/migrations/<migration_name>/migration.sql` and commit.
   3. In the same PR, add `prisma/migrations/<migration_name>/migration.sql <blob> <why>` to the allowlist. `<blob>` is the output of `git rev-parse HEAD:prisma/migrations/<migration_name>/migration.sql`, run after the commit. `<why>` names the PR that added the migration, the failure, and that nothing recorded the original checksum. A pin accepts those bytes only, so a later edit needs a new pin.
   4. Run `bash scripts/check-migrations-immutable.sh --tree` locally; it passes. The PR's `Check migrations are immutable` step fails, as expected, because the PR-time check has no allowlist. `main` has no required checks (HON-584), so merge deliberately and explain the red check in the PR body. The `--tree` step on the `main` push is green because of the pin.

   Do not revert instead. Reverting the PR that added the migration deletes its `migration.sql`, which `--tree` also fails unless it is pinned as `deleted`. It also reverts the code that goes with the schema change, and the re-added migration needs a new timestamp that sorts after anything merged since. CLAUDE.md's "revert, do not fix forward" covers an edit to a migration that _applied_: there, staging and production hold the original checksum. A migration that never applied holds none.

9. Monitor (see below).

## Monitoring after recovery

After any recovery, confirm the fix held and nothing new broke:

1. **Vercel runtime logs.** Watch for 5xx errors tied to the recovered state for at least 30 minutes.
2. **Row counts** for the critical tables — `"user"`, `household`, `meal_plan` (the query in step 4; `user` must stay quoted, since unquoted it is a Postgres keyword). Compare against pre-incident counts (pulled from the recovery branch) to spot unexpected drift.
3. **User-visible flows.** Manually sign in as a test user and walk through the flows that were affected. For meal-plan recoveries, confirm the affected household's current meal plan loads.
4. **Linear post-mortem issue.** File within 24 hours describing the incident, timeline, recovery steps taken, and a follow-up task to prevent recurrence.

### Escalation: corrupted or exposed personal data

If the incident involved **personal data being corrupted or exposed** (not just broken, but _disclosed_ to the wrong party or _modified_ in ways users could not have expected), it may trigger GDPR Art. 33 (72-hour supervisory-authority notification) or Art. 34 (notifying affected users).

Escalate immediately via [`docs/RUNBOOKS/breach-notification.md`](breach-notification.md) ([HON-482](https://linear.app/honkadori/issue/HON-482)). The 72-hour clock starts on _awareness_, not on full investigation. Do not wait to finish this runbook before starting the breach process — they run in parallel.

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
- [`docs/RUNBOOKS/neon-branch-gc.md`](neon-branch-gc.md) — automated cleanup of issue (`<prefix>--hon-<N>`) and orphaned `preview/*` branches (related safety system).
- [`docs/RUNBOOKS/breach-notification.md`](breach-notification.md) — escalation when personal data is corrupted or exposed ([HON-482](https://linear.app/honkadori/issue/HON-482)).
- [`docs/ENVIRONMENT_SETUP.md`](../ENVIRONMENT_SETUP.md) — where `NEON_API_KEY` / `NEON_PROJECT_ID` come from.
- [HON-481](https://linear.app/honkadori/issue/HON-481) — account deletion cascade (soft-delete path that reduces the risk of playbook #3).
- [HON-473](https://linear.app/honkadori/issue/HON-473) — this runbook's tracking issue.
