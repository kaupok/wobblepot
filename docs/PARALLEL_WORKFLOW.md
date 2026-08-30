# Parallel Claude Code Workflow

Run multiple Claude Code instances in parallel using git worktrees for increased throughput.

## Quick Start

```bash
# Interactive: Create worktree and start Claude Code
wt new feat/my-feature

# Autonomous: Create worktree and run /auto-implement
wt auto kaupokorv/hon-51-feature-name   # Branch name from Linear
wt auto HON-51                           # Issue ID
wt auto                                  # Find next available issue

# Management
wt list                                  # List all active worktrees
wt status                                # Show orchestrator and worker status
wt resume feat/my-feature                # Resume existing session
wt cleanup feat/my-feature               # Remove worktree
wt cleanup-all                           # Remove all merged worktrees
```

## Workflow Patterns

**Parallel autonomous implementation (recommended):**

```
Terminal 1: /next-issue
→ Shows 3 candidates with copy-paste commands

Terminal 2: wt auto kaupokorv/hon-51-feature-x
Terminal 3: wt auto kaupokorv/hon-52-feature-y
Terminal 4: wt auto kaupokorv/hon-53-feature-z
```

Each worktree runs `/auto-implement` autonomously. The branch name from Linear ensures proper issue linking.

**Interactive parallel development:**

```
Terminal 1 (main): Planning, code review, coordination
Terminal 2: wt new feat/api-caching     → Long-running implementation
Terminal 3: wt new fix/auth-bug         → Quick bug fix
```

**Research + implementation split:**

```
Terminal 1: Main conversation for planning (no edits, plan mode)
Terminal 2: wt new feat/actual-impl     → Execute the plan
```

## Shell Alias (Optional)

Add to `~/.zshrc` or `~/.bashrc`:

```bash
alias wt='~/Projects/wobblepot/scripts/worktree-claude.sh'
```

Then use `wt new feat/my-feature` from anywhere.

## Best Practices

1. **Use `/next-issue` first** - Get 3 candidates with ready-to-copy commands before spawning worktrees
2. **Use branch names from Linear** - `wt auto kaupokorv/hon-51-...` creates properly named worktrees
3. **Clean up regularly** - Run `wt cleanup-all` to remove merged worktrees
4. **Check status** - Run `wt status` for orchestrator/worker status, `wt list` for worktree listing, or `watch -n 5 wt status` for a live dashboard

## Worktree Location

All parallel worktrees are created in `~/.worktrees/wobblepot/<branch-name>` to keep the project directory clean.

## Untracked Files

When creating a worktree, the script automatically copies these gitignored files from the main repo:

| File                          | Purpose                                              |
| ----------------------------- | ---------------------------------------------------- |
| `.env`                        | Environment variables (DATABASE_URL, API keys, etc.) |
| `.claude/settings.local.json` | Claude Code permissions and settings                 |

Both files are copied verbatim. When Neon branching is enabled, `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in the worktree's copy of `.env` are then patched to point at the fresh Neon branch (see the Neon section below).

**To add more files:** Edit the `UNTRACKED_FILES` array in `scripts/worktree-claude.sh`.

## Per-Worktree Database Isolation

When `NEON_API_KEY` and `NEON_PROJECT_ID` are set in `.env`, each worktree gets its own Neon branch — an isolated copy-on-write database forked from `staging` (or `NEON_PARENT_BRANCH`). This prevents the schema stomping that happens when multiple worktrees share the same dev DB and one runs `pnpm db:migrate`.

**Lifecycle:**

- `wt new <branch>` / `wt auto <branch-or-issue>` creates a Neon branch named `<branch>` (slashes replaced with double-dashes so `feat/foo-bar` and `feat-foo/bar` don't collide, e.g. `auto/hon-339-foo` → `auto--hon-339-foo`) and patches `DATABASE_URL` + `DATABASE_URL_UNPOOLED` in the worktree's `.env` to point at it.
- `wt cleanup <branch>` / `wt cleanup-all` deletes the paired Neon branch after removing the worktree.
- Protected names — `staging`, `main`, `production`, `preview` — are hard-refused by the delete guardrail regardless of how they're passed in.

**Flags:**

- `--fresh-db` — force delete-and-recreate the Neon branch. Useful when reusing a branch name after a previous worktree crashed without cleanup. Works with both `wt new` and `wt auto`.

**Branch cap handling:**

When the Neon project hits its branch cap (10 on the free tier), `wt` automatically runs an orphan GC (deletes Neon branches whose git worktree no longer exists) and retries once. If still over cap, it fails loud — no silent fallback to the shared DB.

GC is prefix-scoped so it can't touch hand-managed branches: orchestrator-spawned `auto-*` branches are always eligible, plus `${NEON_USER_PREFIX}-*` when you've set `NEON_USER_PREFIX` in `.env` (use this if you run `wt new <you>/branch-name` for interactive work). Other prefixes (`feat-`, `fix-`, etc.) must be reclaimed manually via `wt cleanup`.

**Opt-out:**

Leave `NEON_API_KEY` / `NEON_PROJECT_ID` blank. `wt` prints a one-line warning and proceeds with the shared `DATABASE_URL`. Tests (Vitest, Playwright) read `DATABASE_URL`, so they automatically use the per-worktree branch when the feature is enabled.

**Inspecting Neon state:**

```bash
# List all Neon branches (filter your worktree branches by prefix)
pnpm dlx neonctl@2.22.0 branches list --project-id "$NEON_PROJECT_ID"

# Manually GC orphans (also runs automatically on cap errors)
# Or just run any `wt new` to trigger the same GC path on cap.
```

Full setup guide: [ENVIRONMENT_SETUP.md § Neon Database Branching](./ENVIRONMENT_SETUP.md#neon-database-branching-optional).

## Orchestrator (Autonomous Batch Processing)

The orchestrator (`scripts/orchestrator.sh`) is a long-running dispatcher that polls Linear for Todo issues, claims them atomically, spawns `wt auto` workers, and handles the full lifecycle — including failure triage via Claude.

### Quick Start

```bash
# Dry run — connects to Linear, logs what it would do
./scripts/orchestrator.sh --dry-run

# Single issue, full lifecycle
./scripts/orchestrator.sh --once --max-workers 1

# Steady state with 3 concurrent workers
./scripts/orchestrator.sh --max-workers 3

# Ctrl+C → graceful shutdown (waits for workers)
# Ctrl+C again → force kill all workers
```

### How It Works

```
┌─────────────────────────────────────────┐
│              Main Loop                  │
│                                         │
│  1. Monitor workers (reap/timeout)      │
│  2. If slots available → poll Linear    │
│  3. Select best unblocked Todo issue    │
│  4. Claim (move to In Progress)         │
│  5. Spawn wt auto worker               │
│  6. Sleep, repeat                       │
└─────────────────────────────────────────┘
```

**Issue selection** is mechanical — no Claude session overhead:

- Fetch Todo issues via Linear GraphQL (curl + jq)
- Filter out issues already being processed by running workers
- Skip assigned issues — someone owns them (same `assignee: "null"` rule as `/next-issue` and `/auto-implement` Phase 1.4). `move_to_backlog` clears the assignee when it fails an issue back to Backlog, so a re-triaged issue is pickable again. The explicit-ID gate (`/auto-implement HON-XX` 2.1) also accepts `assignee == me` on an `In Progress` issue (my own earlier claim).
- When a force-kill (second signal) stops the orchestrator, it waits for each worker to exit (SIGTERM, then SIGKILL after 10s), removes its worktree (keeping the git branch and its Neon branch, as RETRY does) and returns the issue to Todo **and clears its assignee** — but only while the issue is still `In Progress`; an issue Linear's PR automation already moved to `In Review` keeps that state. A future run then picks the issue up and `wt auto` resumes the existing branch. Without this step, the issue stays `In Progress` **and assigned**, and the picker skips it forever.
- Check `blockedBy` — unblocked only if all blockers are Done/Canceled. A Duplicate blocker never clears on its own: a human follows its `duplicateOf` or fixes the stale relation (same rule as the `/auto-implement` and `/implement-issue` gates)
- Log each skipped candidate once per issue and reason (`[SKIP] HON-XX assigned`, `[SKIP] HON-XX blocked by HON-YY (Duplicate)`), so a stuck issue is visible in `orchestrator.log`. The orchestrator logs each reason one time, not every poll. A changed reason (a blocker moves to a new state) logs again.
- Prioritize: issues that `blocks` others first, then by `priority` field
- Pick one per poll cycle

**Failure triage** is the one place Claude adds value:

- On worker failure, a one-shot `claude -p` call analyzes the log
- Returns: `RETRY` (respawn, max 1 retry), `BACKLOG` (needs refinement), or `NEEDS_HUMAN` (infra problem)
- Failed issues get a comment with log tail, a label (`failed`/`needs-attention`), and move to Backlog

### Configuration

| Flag                 | Env Var                       | Default | Description                     |
| -------------------- | ----------------------------- | ------- | ------------------------------- |
| `--max-workers N`    | `ORCHESTRATOR_MAX_WORKERS`    | 5       | Max concurrent workers          |
| `--poll-interval N`  | `ORCHESTRATOR_POLL_INTERVAL`  | 60      | Seconds between polls           |
| `--worker-timeout N` | `ORCHESTRATOR_WORKER_TIMEOUT` | 3600    | Seconds before killing a worker |
| `--dry-run`          | —                             | false   | Log actions without executing   |
| `--once`             | —                             | false   | Single poll cycle, then exit    |

Requires `LINEAR_API_KEY` env var (format: `lin_api_...`).

### Monitoring

**Live status:** Run `wt status` from any terminal to see orchestrator state, worker phases, elapsed times, and git progress. Use `watch -n 5 wt status` for a live dashboard.

**macOS notifications:** Desktop notifications fire automatically when a worker succeeds or fails, showing the issue ID, outcome, duration, and phase.

**Structured outcome logging:** Every worker completion logs a parseable `[OUTCOME]` line to `orchestrator.log`:

```
[OUTCOME] HON-51 SUCCESS 35m0s 4-commits phase=done
[OUTCOME] HON-53 TIMEOUT 1h1m 2-commits phase=reviewing triage=RETRY
[OUTCOME] HON-55 GATED 8m0s 0-commits phase=planning
[OUTCOME] HON-570 STRANDED 12m3s 3-commits phase=pr-review pr=#650 ci=green
```

`SUCCESS` is logged only for a run that reached `phase=done` — i.e. actually merged. Every other clean exit is `GATED` (shipped nothing) or `STRANDED` (shipped commits but never merged).

**Stranded runs.** A worker can exit cleanly with commits and an open, unmerged PR. That is an incomplete cycle, not a success: the merge never happened and the issue parks in In Review. The orchestrator logs `STRANDED` with the PR number and its CI state (`green` / `pending` / `failing` / `unknown`), comments on the Linear issue with the PR URL and worker log path, adds the `Stranded` label — and **skips cleanup entirely**, so the worktree, local git branch and paired Neon branch all survive. Those artifacts are what finishing the run by hand requires:

```bash
gh pr merge --squash <PR>          # ci=green — one step from done
wt resume <branch>                 # ci=failing/pending — pick the work back up
```

Before deciding a run is stranded, the orchestrator re-checks the PR: a `MERGED` PR is reported as `SUCCESS` even if the phase marker was missing, so a lagging `detect_phase` cannot manufacture a false stranding. Without `gh` on `PATH` the PR cannot be checked at all, and the run is reported `STRANDED` without PR detail — the conservative answer, since a false `SUCCESS` here deletes the branch. Like `GATED`, a stranded exit counts toward the circuit breaker.

The usual cause is a worker that ended its turn waiting on something: in the headless spawn the process exits when a turn ends, so a backgrounded CI poll dies with it. `/auto-implement`'s Execution Model forbids that (foreground wait-chunks instead) — a fresh `STRANDED` line means either that rule was broken or the worker hit a real stop.

A worker can also exit cleanly but make no commits. Such a worker ships nothing, so the orchestrator logs `GATED`, not `SUCCESS`. It comments on the issue, adds the `Gated` label, and — if the issue is still `In Progress` — returns it to Todo and clears the assignee. Without this step, the issue stays `In Progress` and assigned, and the picker skips it forever. A gated exit counts toward the circuit breaker like any other failure.

The picker skips any Todo issue carrying the `Gated` label (`[SKIP] HON-XX gated …`), and also skips issues gated earlier in the same run in case the label write failed: the issue is back in Todo and unassigned, so without that skip the next poll — or the next restart — would re-pick it and respawn the same no-op worker in a loop. Fix the cause, then remove the label (or re-triage) to make it pickable again.

Filter with `grep '\[OUTCOME\]' ~/.worktrees/wobblepot/logs/orchestrator.log`.

### Logs

All logs are written to `~/.worktrees/wobblepot/logs/`:

| File                          | Contents                                     |
| ----------------------------- | -------------------------------------------- |
| `orchestrator.log`            | Main loop activity, claims, triage, outcomes |
| `orchestrator-status.json`    | Machine-readable status for `wt status`      |
| `worker-HON-XX-TIMESTAMP.log` | Full output from each `wt auto` worker       |

### Graceful Shutdown

- First `SIGINT`/`SIGTERM` → stops spawning, waits for running workers
- Second signal → force kills all workers immediately

### Design: Dumb Dispatcher, Smart Workers

The orchestrator is deliberately simple — a bash loop with curl + jq. All intelligence lives in the workers (`/auto-implement`). This means zero API cost for the dispatch loop, predictable behavior, and the ability to run for days.
