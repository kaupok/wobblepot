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

**How `.env` reaches a `wt` subcommand:** the dispatcher _parses_ it (`load_env_file`), it does not `source` it. Lines are split on the first `=`, one matched pair of surrounding quotes is stripped, and only keys matching `^[A-Za-z_][A-Za-z0-9_]*$` are exported; comments, blanks and malformed lines are skipped without failing the command. Values are never evaluated, so a line like `FOO=$(rm -rf ~)` exports a literal string instead of running — under the old `set -a` + `source` it was a working command (HON-580). Everything else matches what `source` did with a well-formed line, including precedence: `.env` still wins over what the calling shell exported, which is what lets `wt auto` patch `DATABASE_URL` into a worktree's own copy. Trailing whitespace and a whitespace-preceded `#` comment are dropped from an unquoted value; a quoted one keeps both, and a quote left open continues onto the next line. A missing `.env` stays a silent no-op; commands that need a specific var validate it themselves.

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

A create failure only reaches that path if it looks like exhaustion and _nothing else_. `neon_classify_create_error` strips the branch name out of the error text before matching, then tests `already exists` / `duplicate` first and the cap keywords (`limit`, `quota`, `cap`, `exceed`, `maximum`) only afterwards. Both halves matter: the cap test is a substring match, so a branch whose slug carries one of those words — `kaupo--hon-580-…-silent-queue-cap-dead-code-stale`, say — used to be read as a capacity problem, which cost HON-580 the reuse path its RETRY depended on and reported a full project that held 6 branches out of 10 (HON-581).

An `already exists` error is not a failure when the git branch is being resumed: `wt auto`'s retry path passes `reuse_existing=1`, and the deliberately-preserved Neon branch is reused as-is. Outside that path it is still a hard stop — use `--fresh-db` to recreate.

GC is scoped so it can't touch hand-managed branches. Eligible:

- **`<prefix>--hon-<N>[-slug]`** — anything carrying a HON id, whatever the prefix. This is what the orchestrator actually creates: `spawn_worker` prefers Linear's `branchName`, so a normal run's branch is `kaupokorv/hon-51-slug` → Neon `kaupokorv--hon-51-slug`, not `auto--hon-51`. Until HON-572 no reaper recognised that shape, so a crashed or SIGKILLed orchestrator leaked its Neon branches until the project hit its cap.
- **`auto-*`** — the no-`branchName` fallback (`wt auto HON-XX` → `auto/hon-XX` → `auto--hon-XX`).
- **`${NEON_USER_PREFIX}-*`** — when you've set `NEON_USER_PREFIX` in `.env` (use this if you run `wt new <you>/branch-name` for interactive work).

Everything else (`feat-`, `fix-`, test scaffolds) must be reclaimed manually via `wt cleanup`.

Each of the three reapers gates differently — the shared name filter is not itself a safety gate:

| Reaper                              | Runs when                                                   | Gates on                                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `neon_gc_orphans` (`wt`)            | The Neon branch cap is hit, as a self-heal before one retry | Name shape, no live git worktree, and `is_protected_neon_branch` (`main` / `staging` / `production` / `preview`) — nothing else |
| `neon-cleanup.sh delete-for-branch` | A PR is merged                                              | Name shape, `default`/`protected` flags, `ALLOWLIST_NAMES`. **No** Linear-status or age gate — the merge is the signal          |
| `neon-cleanup.sh sweep`             | Weekly cron / manual dispatch                               | All of the above **plus** the linked Linear issue being Done/Canceled and age > 24h                                             |

The `wt` GC is the loosest, and widening its name filter widened it further: a hand-made `<you>/hon-51-slug` branch whose worktree you have already removed is now reclaimable at cap time even if its PR is still open. That is the intended trade — the alternative is the orchestrator failing to provision every worker — but if you want an interactive branch held, keep its worktree, or name it without a HON id.

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

The orchestrator (`scripts/orchestrator.sh`) is a long-running dispatcher that polls Linear for Todo issues, claims them by moving each to In Progress, spawns `wt auto` workers, and handles the full lifecycle — including failure triage via Claude.

### Quick Start

`wt start` is the entry point. It loads `.env` — which the orchestrator script itself does not, so invoking `./scripts/orchestrator.sh` directly dies on a missing `LINEAR_API_KEY` — and passes every flag through unchanged.

```bash
# Dry run — connects to Linear, logs what it would do
wt start --dry-run

# Single issue, full lifecycle
wt start --once --max-workers 1

# Steady state with 3 concurrent workers
wt start --max-workers 3

# Stop it
wt stop
```

`wt start` backgrounds the orchestrator, so there is no Ctrl+C to press: `wt stop` drains workers back to Todo and then shuts it down. Output lands in two files under `~/.worktrees/wobblepot/logs/` — `orchestrator.log` (the structured log) and `orchestrator-console.log` (stdout/stderr, which is where a start-up abort's reason actually is).

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

- Fetch Todo issues via Linear GraphQL (curl + jq), bounded by `LINEAR_TODO_PAGE_SIZE` (50). The query asks for one row past it, so a deeper queue is detectable — that row is a real candidate, not a discarded probe — and logs `WARN Todo queue is deeper than the 50-issue query cap`, naming how many it saw. There is no pagination and does not need to be — a poll claims at most one issue — but before HON-580 the truncation was silent, so the orchestrator's view of "what is available" quietly stopped matching Linear's
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
- The log tail is run through `sanitize_log` before it reaches Linear. Redaction is a **literal** match of every `.env` value ≥ 8 chars, plus a `sed` backstop for common secret shapes. It used to be an `awk gsub()`, which reads its pattern as a regex — so a base64 `BETTER_AUTH_SECRET`, a `NEON_API_KEY`, anything with `+ ? . * [ ] ( ) \ ^ $ |` in it, silently failed to match itself and was posted in the clear (HON-572)

**Circuit breaker.** `MAX_CONSECUTIVE_FAILURES` (default 3) pauses new spawns for 10 minutes. The counter means _consecutive runs that shipped nothing_: every non-shipping outcome increments it — failed, timed out, gated, stranded, and retried — and **`handle_success` holds the only reset in the script.**

`handle_failure` deliberately contains no reset. It used to reset on a `RETRY` triage verdict, so a systemic fault whose logs read as transient (rate limit, network flake, the literal word "timeout") produced `fail → RETRY → fail → Backlog` per issue and zeroed the counter every cycle; the breaker never tripped and the whole Todo queue was swept into Backlog one issue per poll. Moving that reset onto the branch that actually respawns a worker is _also_ not enough — that branch runs on every issue's first failure, so the counter merely oscillates `0 → 1 → 0` under the same fault. Only a genuine success clears it (HON-572).

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
wt cleanup <branch>                # ALWAYS, once finished — release the artifacts
```

The release step is not optional. Nothing else reclaims a preserved worktree (a full `pnpm install`), and `wt auto` hard-exits when one already exists — so an unreleased worktree blocks every future run on that branch. The `Stranded` label is what keeps the picker off the issue until you have done it: `select_next_issue` skips `Stranded` exactly as it skips `Gated`, so remove the label only after `wt cleanup`.

If no PR could be resolved at all — none was opened, or `gh` is missing or unauthenticated — Linear never moved the issue anywhere, so it is still `In Progress` and assigned where `claim_issue` left it. That path returns the issue to Todo and clears the assignee (as the gated path does), leaving the `Stranded` label as the gate. A PR in any other state is left alone: `In Review` is the accurate state when a PR exists. A `CLOSED`-but-unmerged PR is reported as such and told to reopen rather than merge — `gh pr merge` on a closed PR fails.

Before deciding a run is stranded, the orchestrator re-checks the PR: a `MERGED` PR is reported as `SUCCESS` even if the phase marker was missing, so a lagging `detect_phase` cannot manufacture a false stranding. Without `gh` on `PATH` the PR cannot be checked at all, and the run is reported `STRANDED` without PR detail — the conservative answer, since a false `SUCCESS` here deletes the branch. Like `GATED`, a stranded exit counts toward the circuit breaker.

The usual cause is a worker that ended its turn waiting on something: in the headless spawn the process exits when a turn ends, so a backgrounded CI poll dies with it. `/auto-implement`'s Execution Model forbids that (foreground wait-chunks instead) — a fresh `STRANDED` line means either that rule was broken or the worker hit a real stop.

A worker can also exit cleanly but make no commits. Such a worker ships nothing, so the orchestrator logs `GATED`, not `SUCCESS`. It comments on the issue, adds the `Gated` label, and — if the issue is still `In Progress` — returns it to Todo and clears the assignee. Without this step, the issue stays `In Progress` and assigned, and the picker skips it forever. A gated exit counts toward the circuit breaker like any other failure.

The picker skips any Todo issue carrying the `Gated` label (`[SKIP] HON-XX gated …`), and also skips issues gated earlier in the same run in case the label write failed: the issue is back in Todo and unassigned, so without that skip the next poll — or the next restart — would re-pick it and respawn the same no-op worker in a loop. Fix the cause, then remove the label (or re-triage) to make it pickable again.

Filter with `grep '\[OUTCOME\]' ~/.worktrees/wobblepot/logs/orchestrator.log`.

### Logs

All logs are written to `~/.worktrees/wobblepot/logs/`:

| File                          | Contents                                               |
| ----------------------------- | ------------------------------------------------------ |
| `orchestrator.log`            | Main loop activity, claims, triage, outcomes           |
| `orchestrator-console.log`    | The orchestrator's raw stdout/stderr (crashes, aborts) |
| `orchestrator-status.json`    | Machine-readable status for `wt status`                |
| `worker-HON-XX-TIMESTAMP.log` | Full output from each `wt auto` worker                 |

`orchestrator.log` has exactly one writer — the script's own `log()` — so each line appears once, clean, with no ANSI escapes. `wt start` sends the process's stdout/stderr to `orchestrator-console.log` instead of folding them back into the same file, which used to store every line twice, once escape-wrapped (HON-572). A start-up abort never reaches `log()`, so the console log is where to look when `wt start` reports a failure.

### Graceful Shutdown

- First `SIGINT`/`SIGTERM` → stops spawning, waits for running workers
- Second signal → force kills all workers immediately, then drains: each worker's issue goes back to Todo unassigned before the orchestrator exits

`wt stop` sends both signals for you and then waits for the drain to finish rather than SIGKILLing on a fixed timer. The wait scales with the work: `max(60s, 15s × active workers)`, read from `orchestrator-status.json`, with the 60s floor used whenever that file is missing or unreadable. Killing partway through the drain is what orphans `claude` processes and strands their issues `In Progress` **and assigned** — the state the picker skips forever.

The poll loop sleeps via `interruptible_sleep` (a backgrounded `sleep` plus `wait`) so the first signal is acted on within a second. A plain foreground `sleep "$POLL_INTERVAL"` blocks trap delivery for up to 60s, which is longer than the 15s `wt stop` allows before escalating.

> **Known gap (HON-575).** The _escalation_ still does not reach the force path. Bash will not re-enter a trap handler for a signal whose handler is already running, so the second `SIGTERM` sent while `shutdown()`'s graceful wait loop is executing is dropped: `FORCE_SHUTDOWN` is never set and `drain_workers_to_todo` never runs. Closing it means restructuring `shutdown()` to set flags only and letting the main loop perform the drain. Until then, after a `wt stop` that reports `Drain did not finish in time`, check `wt list` for orphaned worktrees and Linear for issues left `In Progress`.

### Design: Dumb Dispatcher, Smart Workers

The orchestrator is deliberately simple — a bash loop with curl + jq. All intelligence lives in the workers (`/auto-implement`). This means zero API cost for the dispatch loop, predictable behavior, and the ability to run for days.
