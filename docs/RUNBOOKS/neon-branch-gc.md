# Neon branch garbage collection

## Why this exists

The parallel-worktree `/auto-implement` workflow creates one Neon branch per HON issue. The name is the git branch with `/` mapped to `--`, so it is usually `<prefix>--hon-<N>-<slug>` (`kaupokorv--hon-51-slug`) — the orchestrator prefers Linear's `branchName` — and `auto--hon-<N>` only on the fallback path. The Neon Free tier caps compute endpoints at **10 per project**. Without cleanup, these stale branches drift up to the cap, the Vercel-Neon integration starts racing its own bookkeeping, and Vercel preview env vars get pinned to endpoint names that have already been reaped — surfacing as `P1001: Can't reach database server` in CI. See HON-492 for the incident.

## How the automation works

Owner: [`.github/workflows/neon-cleanup.yml`](../../.github/workflows/neon-cleanup.yml) calling [`scripts/neon-cleanup.sh`](../../scripts/neon-cleanup.sh).

| Trigger                                     | Job        | What it does                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pull_request.closed` with `merged == true` | `on-merge` | Maps the merged head ref to its Neon branch (`/` → `--`); when the branch carries no HON id, falls back to `auto--hon-<N>` from `Closes HON-<N>` in the PR body. Deletes the matching Neon branch. Does not gate on Linear status — the merge is the signal.                                                                                                                         |
| `schedule: "17 3 * * *"` (daily 03:17 UTC)  | `sweep`    | Lists all `<prefix>--hon-<N>[-slug]` Neon branches. For each, queries Linear for the linked issue's state. Deletes if state is `Done` / `Canceled`, the branch is > 24h old, and the branch is not `primary` / `protected` / on the hardcoded allowlist. Any Linear API failure → skip (fail-safe). Also reaps orphaned `preview/<ref>` branches through their own gate — see below. |
| `workflow_dispatch`                         | `sweep`    | Same as the scheduled sweep. Accepts a `dry_run` input (default `true`).                                                                                                                                                                                                                                                                                                             |

## `preview/*` is not ours — but its orphans are reaped

Every branch above is one the tooling created. `preview/<git-branch>` is not: the **Vercel–Neon integration** creates it with a PR's preview deployment. Nothing in this repo creates or renames it. (`is_protected_neon_branch` in `scripts/worktree-claude.sh` refuses the bare name `preview`, not the `preview/<git-branch>` shape — it is a backstop against provisioning over a reserved name.)

**A live PR's preview branch is held for the life of the PR, and must never be deleted.** Deleting it pins the PR's Vercel env vars to an endpoint that no longer exists, which resurfaces as `P1001: Can't reach database server` in preview builds — the HON-492 failure. It also means **each in-flight issue costs two branches, not one** — its worktree branch and its preview branch — which is the arithmetic behind the `2N + 2S + 3` budget in [`docs/PARALLEL_WORKFLOW.md`](../PARALLEL_WORKFLOW.md) → Configuration and the startup check in `scripts/orchestrator.sh` (`check_branch_budget`).

### What the integration actually does (HON-852)

The integration does delete its branch when the PR merges — within seconds (`delete_timeline` 7 s after `head_ref_deleted` on PR #889). What it also does is leave, or re-create, branches that nothing owns:

- **Closed without merge.** `preview/kaupo/hon-702-…` (PR #798, closed unmerged 2026-09-22, git branch left in place) was still there nine days later. Deleting the git branch did not make the integration remove it.
- **Re-created after merge.** `preview/kaupo/hon-802-…` was deleted at merge (11:00:07 on 2026-09-29) and **created again at 18:53:56**, same name, parent `main`, with no GitHub event, Vercel deployment, git ref or worktree behind it. `hon-796`, `hon-800` and `hon-801` followed the same shape overnight, hours apart, one at a time.

All of them had `creation_source: "vercel"`, `compute_time_seconds: 0` and `written_data_bytes: 0`. Each took one of the ten free-plan branches, and at three queue workers there is exactly one spare: on 2026-09-29 the project sat at 10 of 10 and `pnpm test:e2e:local` failed with `branches limit exceeded`. The trigger is not visible from the repo, the GitHub API or the Vercel CLI; it lives in the integration's settings (see [Integration settings](#integration-settings)).

### The `preview/*` gate

Both reapers now reclaim a `preview/<ref>` branch, through a gate of its own that is separate from `SAFE_BRANCH_REGEX` / `is_safe_to_delete` (whose character class still excludes `/`, so the `<prefix>--hon-<N>` path cannot reach a preview name) and from `neon_gc_orphan_names` (which still emits only the tooling's own shapes). A `preview/<ref>` branch is deleted only when **all** of these hold:

- `<ref>` is a plausible branch name: `PREVIEW_REF_REGEX` (`^[A-Za-z0-9._/-]+$`), no `..` or `//`, not starting with `-` or `/`, not ending with `/`. Anything else is left for a human, never passed to `git` or `gh`.
- the branch is not `default`/`primary`, not `protected`, and not in `ALLOWLIST_NAMES`
- `git ls-remote --exit-code --heads origin refs/heads/<ref>` exits **2** (no such ref). Any other failure — auth, network — keeps the branch.
- no open PR has `<ref>` as its head (`gh pr list --state open --head <ref>`). A `gh` failure keeps the branch. This is what protects a live PR.
- `sweep` only: `updated_at` is older than `NEON_CLEANUP_MIN_AGE_HOURS` (default 24)

The ref and open-PR checks are the ownership signal; there is no Linear lookup, because a preview branch has no issue of its own. A branch with usage but no ref is still an orphan — the sweep deletes it and logs its `compute_time_seconds` / `written_data_bytes` on the candidate line so it shows up.

Consequence: a closed-unmerged PR whose git branch is **left on origin** keeps its preview branch. Delete the git branch and the next sweep reclaims it.

| Reaper                                                    | `preview/*` behaviour                                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `neon-cleanup.sh sweep` (daily + dispatch)                | The gate above, including the age gate. Honours `NEON_CLEANUP_DRY_RUN` like the HON path.                                             |
| `neon_gc_orphans` → `neon_gc_preview_orphan_names` (`wt`) | The gate above, **without** the age gate — it runs only when the cap is already hit. Uses the local `git` and `gh` auth.              |
| `neon-cleanup.sh delete-for-branch` (on merge)            | None, deliberately. The integration deletes its own branch at merge; the re-creation comes hours later, so only a sweep can catch it. |

### Integration settings

The root cause is in the Vercel project's Neon integration, which the agent cannot see: whether "create a branch for each preview deployment" is on, and whether the integration has its own "delete obsolete branches" option that is off. If a setting explains the re-creations, record it here — the sweep is still worth having for the closed-without-merge case.

## Safety invariants

All must hold for deleting a `<prefix>--hon-<N>` branch (enforced in `is_safe_to_delete` in the script). `preview/*` branches go through their own gate instead — [see above](#the-preview-gate).

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

# One-time cleanup (bypass 24h age gate; still requires Done/Canceled status,
# and still requires a preview/* ref to be gone with no open PR).
gh workflow run neon-cleanup.yml -f dry_run=false -f min_age_hours=0
```

To sweep by hand from a checkout — e.g. to clear a `preview/*` orphan that is holding the last free branch — run the script directly. It needs `NEON_API_KEY`, `NEON_PROJECT_ID` and `LINEAR_API_KEY` (all in `.env`) and an authenticated `gh`:

```bash
# Export the three keys from .env by hand — .env is not safe to `source`.
export NEON_API_KEY=… NEON_PROJECT_ID=… LINEAR_API_KEY=…
# Dry-run first: every candidate is logged as `preview candidate: …` / `DRY-RUN would delete: …`.
NEON_CLEANUP_DRY_RUN=1 ./scripts/neon-cleanup.sh sweep
# Then delete. min_age_hours=0 reaches a branch the integration created minutes ago.
NEON_CLEANUP_DRY_RUN=0 NEON_CLEANUP_MIN_AGE_HOURS=0 ./scripts/neon-cleanup.sh sweep
```

Every run emits a summary (`considered`, `deleted`, `skipped_safety`, `skipped_status`, and the `preview` counters) to the job summary and to the script's stderr.

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
- Preview considered: 3
- Preview candidates: 1
- Preview deleted: 1
- Preview with usage: 0
- Preview skipped: open-pr=1 ref-on-remote=1
- Dry run: 0
```

- **Considered** — `<prefix>--hon-<N>` branches whose name matched the regex. Sanity check: should roughly equal the number of `*--hon-*` branches you see in `neonctl branches list`.
- **Skipped (safety)** — regex matched but primary/protected/age guard blocked deletion. Non-zero here usually means a young branch (< 24h) — will be picked up on a later run.
- **Skipped (status)** — Linear issue was not yet `Done`/`Canceled`, or the Linear lookup failed. The latter is the fail-safe kicking in.
- **Deleted** / **Would delete** — depends on `dry_run`. Compare against the list of recently-merged HON issues to spot anything surprising.
- **Preview considered** — every `preview/*` branch. **Preview candidates** — those that passed the gate; **Preview deleted** / **would delete** counts the ones actually removed.
- **Preview with usage** — candidates with non-zero `compute_time_seconds` or `written_data_bytes`. The integration's re-created orphans have none, so a non-zero value is worth a look in the log.
- **Preview skipped** — `reason=count` pairs. `open-pr` and `ref-on-remote` are live PRs or kept git branches, and expected. `too-young` is picked up on a later run. `ref-lookup-failed` / `pr-lookup-failed` are the fail-safe (check `GH_TOKEN` and the checkout); `gate-error` means the gate itself failed partway (an unparseable branch record) and kept the branch. `invalid-ref` / `protected` / `allowlisted` need a human.

## Recovery: a legitimate branch got deleted

If a live branch was deleted by mistake (for example, if the regex or allowlist is ever loosened):

1. Stop the bleeding — set `NEON_CLEANUP_DRY_RUN=1` immediately so subsequent sweeps log only.
2. Restore within the Neon PITR window. Neon Free retains PITR for 24h; Pro extends this. See the [database recovery runbook](./database-recovery.md) (HON-473) for the step-by-step restore. In short: Neon console → Project → Branches → Create branch → choose "At a point in time" → pick a timestamp before the deletion → restore.
3. If the data is gone (> 24h old on Free), rebuild from the latest staging branch + `pnpm db:seed`.
4. Post-mortem: figure out which invariant failed, tighten the regex/allowlist in `scripts/neon-cleanup.sh`, land the fix, then flip `NEON_CLEANUP_DRY_RUN=0` once confident.

## Related

- `scripts/neon-cleanup.sh` — all logic, including safety invariants
- `scripts/maybe-migrate.sh` — pre-flight endpoint check (HON-492)
- `.claude/skills/auto-implement/SKILL.md` — origin of `*--hon-*` branches
- `docs/PARALLEL_WORKFLOW.md` → Configuration — the `2N + 2S + 3` branch budget and the `--max-workers` ceiling it bounds
- HON-473 — database recovery runbook (PITR procedures)
- HON-492 — incident + design that produced this runbook
- HON-609 / HON-616 — the cap hit with nothing stale to collect; `preview/*` accounting and the startup budget check
- HON-852 — the integration re-creating `preview/*` branches after merge, and the `preview/*` gate
