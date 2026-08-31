# Neon branch garbage collection

## Why this exists

The parallel-worktree `/auto-implement` workflow creates one Neon branch per HON issue. The name is the git branch with `/` mapped to `--`, so it is usually `<prefix>--hon-<N>-<slug>` (`kaupokorv--hon-51-slug`) — the orchestrator prefers Linear's `branchName` — and `auto--hon-<N>` only on the fallback path. The Neon Free tier caps compute endpoints at **10 per project**. Without cleanup, these stale branches drift up to the cap, the Vercel-Neon integration starts racing its own bookkeeping, and Vercel preview env vars get pinned to endpoint names that have already been reaped — surfacing as `P1001: Can't reach database server` in CI. See HON-492 for the incident.

## How the automation works

Owner: [`.github/workflows/neon-cleanup.yml`](../../.github/workflows/neon-cleanup.yml) calling [`scripts/neon-cleanup.sh`](../../scripts/neon-cleanup.sh).

| Trigger                                     | Job        | What it does                                                                                                                                                                                                                                                                                        |
| ------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pull_request.closed` with `merged == true` | `on-merge` | Maps the merged head ref to its Neon branch (`/` → `--`); when the branch carries no HON id, falls back to `auto--hon-<N>` from `Closes HON-<N>` in the PR body. Deletes the matching Neon branch. Does not gate on Linear status — the merge is the signal.                                        |
| `schedule: "17 3 * * 1"` (Monday 03:17 UTC) | `sweep`    | Lists all `<prefix>--hon-<N>[-slug]` Neon branches. For each, queries Linear for the linked issue's state. Deletes if state is `Done` / `Canceled`, the branch is > 24h old, and the branch is not `primary` / `protected` / on the hardcoded allowlist. Any Linear API failure → skip (fail-safe). |
| `workflow_dispatch`                         | `sweep`    | Same as the scheduled sweep. Accepts a `dry_run` input (default `true`).                                                                                                                                                                                                                            |

## Safety invariants

All must hold for deletion (enforced in `is_safe_to_delete` in the script):

- Branch name matches `SAFE_BRANCH_REGEX` — `^[A-Za-z0-9._-]+--hon-([0-9]+)(-[A-Za-z0-9._-]+)?$`. Widened from `^auto--hon-[0-9]+$` in HON-572, which matched only the fallback shape and left every real orchestrator branch unreaped. The name filter is not the safety gate — the `primary`/`protected` flags and the allowlist still have to pass on both paths, and `sweep` additionally requires the linked Linear issue to be Done/Canceled and the branch to be older than the age gate. (`delete-for-branch` deliberately skips those two: the merge is the signal.)
- `primary != true` and `protected != true` on the Neon branch record
- Name is not in the allowlist `{main, staging, dev/kaupo, vercel-dev}`
- `sweep` only: branch `updated_at` is older than `NEON_CLEANUP_MIN_AGE_HOURS` (default 24)
- `sweep` only: linked Linear issue's state type is `completed` or `canceled`. Linear lookup failure → do not delete.

## Triggering manually

```bash
# Dry-run (default) — logs what would be deleted, makes no DELETE calls.
gh workflow run neon-cleanup.yml

# Live.
gh workflow run neon-cleanup.yml -f dry_run=false

# One-time cleanup (bypass 24h age gate; still requires Done/Canceled status).
gh workflow run neon-cleanup.yml -f dry_run=false -f min_age_hours=0
```

Both runs emit a summary (`considered`, `deleted`, `skipped_safety`, `skipped_status`) to the job summary and to the script's stderr.

## Flipping dry-run off

After ~3 days of dry-run runs that match expectations, flip the repo variable so the `pull_request.closed` job also deletes instead of logging:

```bash
gh variable set NEON_CLEANUP_DRY_RUN --body "0"
```

Scheduled sweeps read the same variable. Manual `workflow_dispatch` runs can override via the `dry_run` input regardless of the variable's value.

## Required env

### GitHub Actions (repo-level)

| Setting                | Kind     | Value                                           | How to set                                        |
| ---------------------- | -------- | ----------------------------------------------- | ------------------------------------------------- |
| `NEON_API_KEY`         | secret   | personal Neon API key                           | `gh secret set NEON_API_KEY`                      |
| `LINEAR_API_KEY`       | secret   | Linear API key (same one used locally)          | `gh secret set LINEAR_API_KEY`                    |
| `NEON_PROJECT_ID`      | variable | Neon project ID (read it from the Neon console) | `gh variable set NEON_PROJECT_ID --body "<id>"`   |
| `NEON_CLEANUP_DRY_RUN` | variable | `"1"` (dry-run) or `"0"` (live)                 | `gh variable set NEON_CLEANUP_DRY_RUN --body "1"` |

### Vercel (Preview environment)

`scripts/maybe-migrate.sh` runs a pre-flight check that asks the Neon API whether the endpoint in `DATABASE_URL_UNPOOLED` exists before kicking off the migrate retry loop. Without these vars the check soft-skips and preview builds fall through to the existing 5-attempt retry.

- `NEON_API_KEY` — add via Vercel dashboard → Project → Settings → Environment Variables → Preview
- `NEON_PROJECT_ID` — same, Preview only

## Interpreting the sweep summary

Example `$GITHUB_STEP_SUMMARY` output:

```
## Neon cleanup sweep

- Considered: 5
- Deleted: 4
- Skipped (safety): 0
- Skipped (status): 1
- Dry run: 0
```

- **Considered** — branches whose name matched the regex. Sanity check: should roughly equal the number of `*--hon-*` branches you see in `neonctl branches list`.
- **Skipped (safety)** — regex matched but primary/protected/age guard blocked deletion. Non-zero here usually means a young branch (< 24h) — will be picked up next week.
- **Skipped (status)** — Linear issue was not yet `Done`/`Canceled`, or the Linear lookup failed. The latter is the fail-safe kicking in.
- **Deleted** / **Would delete** — depends on `dry_run`. Compare against the list of recently-merged HON issues to spot anything surprising.

## Recovery: a legitimate branch got deleted

If a live branch was deleted by mistake (for example, if the regex or allowlist is ever loosened):

1. Stop the bleeding — set `NEON_CLEANUP_DRY_RUN=1` immediately so subsequent sweeps log only.
2. Restore within the Neon PITR window. Neon Free retains PITR for 24h; Pro extends this. See HON-473's database recovery runbook (once merged) for the step-by-step restore. In short: Neon console → Project → Branches → Create branch → choose "At a point in time" → pick a timestamp before the deletion → restore.
3. If the data is gone (> 24h old on Free), rebuild from the latest staging branch + `pnpm db:seed`.
4. Post-mortem: figure out which invariant failed, tighten the regex/allowlist in `scripts/neon-cleanup.sh`, land the fix, then flip `NEON_CLEANUP_DRY_RUN=0` once confident.

## Related

- `scripts/neon-cleanup.sh` — all logic, including safety invariants
- `scripts/maybe-migrate.sh` — pre-flight endpoint check (HON-492)
- `.claude/skills/auto-implement/SKILL.md` — origin of `*--hon-*` branches
- HON-473 — database recovery runbook (PITR procedures)
- HON-492 — incident + design that produced this runbook
