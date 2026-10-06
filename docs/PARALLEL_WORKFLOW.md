# Parallel Claude Code Workflow

Run several Claude Code sessions at once, each in its own git worktree with its own Neon database branch. The usual way is the orchestrator: move issues to `Queued` in Linear, run `wt start`, and it spawns one `wt auto` worker per issue. Running a single worktree by hand is covered [further down](#running-one-worktree-by-hand).

## Orchestrator

The orchestrator (`scripts/orchestrator.sh`, started with `wt start`) is a long-running dispatcher. It polls Linear for issues in the `Queued` state, claims each by moving it to In Progress, spawns a `wt auto` worker for it, and handles the rest of the lifecycle, including failure triage via Claude.

**It reads only `Queued`** (`STATE_QUEUED` in the script). Todo and Backlog are never picked up, and every path that hands an issue back — gated, Neon-cap requeue, pre-claim restore, force-shutdown drain — returns it to Queued. Failures go to Backlog (`handle_failure`). What belongs in Queued, and what goes to Todo instead, is in [CLAUDE.md](../CLAUDE.md) → "Queued is the queue".

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

`wt start` backgrounds the orchestrator, so there is no Ctrl+C to press: `wt stop` drains workers back to Queued and then shuts it down. Output lands in two files under `~/.worktrees/wobblepot/logs/` — `orchestrator.log` (the structured log) and `orchestrator-console.log` (crashes and start-up aborts only, which is where a start-up abort's reason actually is).

### How It Works

```
┌─────────────────────────────────────────┐
│              Main Loop                  │
│                                         │
│  1. Monitor workers (reap/timeout)      │
│  2. If slots available → poll Linear    │
│  3. Select best unblocked Queued issue  │
│  4. Claim (move to In Progress)         │
│  5. Spawn wt auto worker               │
│  6. Sleep, repeat                       │
│                                         │
│  If committed main changed on disk:     │
│  stop claiming, reload once idle        │
│  Every 10 min: warn if the checkout is  │
│  behind origin/main for its own code    │
└─────────────────────────────────────────┘
```

**Issue selection** is mechanical — no Claude session overhead:

- Fetch Queued issues via Linear GraphQL (curl + jq), bounded by `LINEAR_QUEUE_PAGE_SIZE` (50). The query asks for one row past it, so a deeper queue is detectable — that row is a real candidate, not a discarded probe — and logs `WARN Queue is deeper than the 50-issue query cap`, naming how many it saw. There is no pagination and does not need to be — a poll claims at most one issue — but before HON-580 the truncation was silent, so the orchestrator's view of "what is available" quietly stopped matching Linear's
- Filter out issues already being processed by running workers
- Skip assigned issues — someone owns them (same `assignee: "null"` rule as `/next-issue` and `/auto-implement` Phase 1.4). `move_to_backlog` clears the assignee when it fails an issue back to Backlog, so a re-triaged issue is pickable again. The explicit-ID gate (`/auto-implement HON-XX` 2.1) also accepts `assignee == me` on an `In Progress` issue (my own earlier claim).
- When a force-kill (second signal) stops the orchestrator, it waits for each worker to exit (SIGTERM, then SIGKILL after 10s), removes its worktree (keeping the git branch and its Neon branch, as RETRY does) and returns the issue to Queued **and clears its assignee** — but only while the issue is still `In Progress`; an issue Linear's PR automation already moved to `In Review` keeps that state. A future run then picks the issue up and `wt auto` resumes the existing branch. Without this step, the issue stays `In Progress` **and assigned**, and the picker skips it forever. The exception is a worker running an issue's automatic finish attempt: the drain records it as a strand, adds the `Stranded` label and keeps its worktree. It returns the issue to Queued only when there is no PR (see Stranded runs).
- Check `blockedBy` — unblocked only if all blockers are Done/Canceled. A Duplicate blocker never clears on its own: a human follows its `duplicateOf` or fixes the stale relation (same rule as the `/auto-implement` and `/implement-issue` gates)
- Log each skipped candidate once per issue and reason (`[SKIP] HON-XX assigned`, `[SKIP] HON-XX blocked by HON-YY (Duplicate)`), so a stuck issue is visible in `orchestrator.log`. The orchestrator logs each reason one time, not every poll. A changed reason (a blocker moves to a new state) logs again.
- Prioritize: issues that `blocks` others first, then by `priority` field
- Pick one per poll cycle

**Failure triage** is the one place Claude adds value:

- On worker failure, a one-shot `claude -p` call analyzes the log
- Returns: `RETRY` (respawn, max 1 retry), `BACKLOG` (needs refinement), or `NEEDS_HUMAN` (infra problem)
- A `RETRY` (and the Neon-cap one-retry) respawns with a **retry note** — phase, failure type, duration, commit count and the last 40 log lines through `sanitize_log` — passed as `ORCHESTRATOR_RETRY_CONTEXT` to `wt auto`, which appends it to the `/auto-implement` prompt. The skill reads it first and resumes from the kept branch or open PR instead of starting over. Progress markers in the quoted tail are defanged (`[x:complete]` → `(x:complete)`) so attempt 1's markers can never be read as attempt 2's progress (HON-728)
- Failed issues get a comment with log tail, a label (`Failed` or `Needs attention`), and move to Backlog
- The log tail is run through `sanitize_log` before it reaches Linear. Redaction is a **literal** match of every `.env` value ≥ 8 chars, plus a `sed` backstop for common secret shapes. It used to be an `awk gsub()`, which reads its pattern as a regex — so a base64 `BETTER_AUTH_SECRET`, a `NEON_API_KEY`, anything with `+ ? . * [ ] ( ) \ ^ $ |` in it, silently failed to match itself and was posted in the clear (HON-572)

**Circuit breaker.** `MAX_CONSECUTIVE_FAILURES` (default 3) pauses new spawns for 10 minutes. The counter means _consecutive runs that shipped nothing_: every non-shipping outcome increments it — failed, timed out, gated, stranded, and retried — and **`handle_success` holds the only reset in the script.**

`handle_failure` deliberately contains no reset. It used to reset on a `RETRY` triage verdict, so a systemic fault whose logs read as transient (rate limit, network flake, the literal word "timeout") produced `fail → RETRY → fail → Backlog` per issue and zeroed the counter every cycle; the breaker never tripped and the whole queue was swept into Backlog one issue per poll. Moving that reset onto the branch that actually respawns a worker is _also_ not enough — that branch runs on every issue's first failure, so the counter merely oscillates `0 → 1 → 0` under the same fault. Only a genuine success clears it (HON-572).

### Configuration

| Flag                 | Env Var                             | Default           | Description                                                                                                                  |
| -------------------- | ----------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `--max-workers N`    | `ORCHESTRATOR_MAX_WORKERS`          | 3                 | Max concurrent workers                                                                                                       |
| `--poll-interval N`  | `ORCHESTRATOR_POLL_INTERVAL`        | 60                | Seconds between polls                                                                                                        |
| `--worker-timeout N` | `ORCHESTRATOR_WORKER_TIMEOUT`       | 10800             | Seconds before killing a worker                                                                                              |
| `--dry-run`          | —                                   | false             | Log actions without executing                                                                                                |
| `--once`             | —                                   | false             | Single poll cycle, then exit                                                                                                 |
| —                    | `NEON_BRANCH_CAP`                   | 10                | Neon branches the plan allows                                                                                                |
| —                    | `ORCHESTRATOR_CAP_REQUEUE_COOLDOWN` | 1800              | Seconds before a cap-requeued issue is pickable again                                                                        |
| —                    | `ORCHESTRATOR_TRIAGE_TIMEOUT`       | 120               | Seconds the failure-triage `claude -p` call may run before the issue falls back to Backlog                                   |
| —                    | `CLAUDE_AUTO_MODEL`                 | `claude-opus-5-5` | Model every `wt auto` worker runs; read by `scripts/worktree-claude.sh`, not the orchestrator                                |
| —                    | `CLAUDE_REVIEW_MODEL`               | `claude-opus-5-5` | Model the PR reviewer (`scripts/pr-review.sh`) runs. Not read from `.env` outside a `wt auto` worker: export it in the shell |
| —                    | `CLAUDE_TRIAGE_MODEL`               | `claude-sonnet-5` | Model the orchestrator's failure-triage `claude -p` call runs                                                                |
| —                    | `cleanupPeriodDays`                 | 365               | Days Claude Code keeps transcripts; a setting in `~/.claude/settings.json`, not an env var                                   |

Requires `LINEAR_API_KEY` env var (format: `lin_api_...`). Every env var above except `CLAUDE_REVIEW_MODEL` can live in `.env`: `wt` loads it for every subcommand, and the workers the orchestrator spawns inherit it. `scripts/pr-review.sh` does not load `.env`, so a `.env` value reaches the reviewer only when a `wt auto` worker runs it; `/review-pr`, `/triage-pr-comments` and `/merge` in the main checkout need it exported in the shell that started the session.

The three model defaults live in `scripts/models.sh`, the one file under `scripts/` that names a model ID; see [Swapping models](#swapping-models) before changing one.

`cleanupPeriodDays` defaults to 30. Claude Code then deletes everything under `~/.claude/projects/` older than that, subagent transcripts included, by file age; resuming a session does not reset the clock. Those transcripts are the only record of what a run cost, and `pnpm agent-cost` (`scripts/agent-cost-per-pr.ts`) reads nothing else, so it was raised to 365 on 2026-10-01 (HON-785). It lives in the user-scope file because every worktree session reads that file and no repo file reaches them all.

#### Branch budget

**`--max-workers` is bounded by the Neon branch cap, not by local CPU.** Each in-flight issue consumes **two** Neon branches: the worktree's `<prefix>--hon-<N>` (created by `neon_branch_name` in `worktree-claude.sh`) and the Vercel–Neon integration's `preview/<git-branch>`, created when the PR opens and held until it merges.

**Stranded runs hold the same two indefinitely.** `record_stranded` frees the worker slot but deliberately preserves the worktree, the git branch and its Neon branch — "nothing else reclaims them", as the Linear comment it posts says — while the unmerged PR keeps its `preview/*` alive. So with S stranded runs and the three permanent branches (`main`, `staging`, `dev/kaupo`), peak usage is:

```
2N + 2S + 3
```

On Neon's free plan (10 branches): N=3 fits at 9, N=4 does not at 11. A stranded run holds two branches, so the one spare branch at N=3 does not absorb even a **single** stranded run at full load (2·3 + 2·1 + 3 = 11); the next worker to start hits the cap. Treat a stranded worktree as something to clear (`wt list`, then `wt cleanup <branch>`), not as headroom.

**A local review server takes that same spare.** `pnpm review:local` in its default branch mode holds one `e2e-local-*` branch for as long as it runs (it is deleted when the server stops), so at N=3 it uses the single spare: run it while a run is stranded, or while a fourth consumer holds a branch, and one of them hits the cap. When no slot is free, `pnpm review:local --db env` reviews against the database in `.env` and takes no branch (`docs/CHROME_TESTING.md` → "Reviewing sign-up and onboarding"). `pnpm test:e2e:local` costs the same one branch for the length of the suite.

No reaper reclaims either shape on its own. `neon_gc_orphans` skips any branch whose git worktree is still live — which a stranded run's is — and `neon-cleanup.sh`'s sweep requires the Linear issue to be Done or Canceled, while a stranded one sits in In Review. A live PR's `preview/*` escapes both too: the `preview/*` gate reaps a preview branch only once its git ref is gone from `origin` and no open PR has it. That is correct for a live PR, but it means the budget above is the only thing protecting you.

**The budget assumes preview branches go away with their PR, and they do not always.** The integration re-creates `preview/*` branches hours after their PR merged, with no deployment behind them, and leaves a closed-unmerged PR's branch in place while its git branch exists (HON-852). Each one is a branch outside `2N + 2S + 3`, so a single one takes the spare at N=3. The daily sweep reclaims them once they are 24h old; at the cap, `neon_gc_orphans` reclaims them at once. If the cap is hit with no stranded run, list the project's branches (`neonctl branches list`) and look for a `preview/*` whose PR has merged.

**The ceiling is enforced at startup, not merely defaulted.** `check_branch_budget` computes `2N + 3` against `NEON_BRANCH_CAP` before the poll loop begins and **refuses to start** when it does not fit, naming the largest `--max-workers` that does. It warns — and still starts — when the budget fits with no spare branch left, since the spare is what absorbs a stranded run. `NEON_BRANCH_CAP` defaults to 10, the Free-tier limit; raise it only after actually raising the Neon plan, because nothing validates it against Neon. A non-numeric or zero `--max-workers` is refused here too: bash reads it as `0`, which used to produce an orchestrator that started, logged healthily and never spawned anything.

Exceeding the cap anyway — a hand-run `wt new`, or stranded runs holding branches — makes `wt auto` die during worktree setup with `branches limit exceeded`, before Claude runs at all (HON-609, 2026-09-03). That failure is now **triaged deterministically as capacity rather than as a bad issue** (HON-616): the orchestrator matches the terminal cap message in the worker log ahead of the Claude triage call, retries once in case branches freed, and then returns the issue to **Queued, unassigned and unlabelled**, with a comment explaining the cap — instead of Backlog with `Needs attention`, which is both false and sticky. A requeued issue then cools down for `ORCHESTRATOR_CAP_REQUEUE_COOLDOWN` seconds (default 1800) before it can be picked again, so a still-full project is retried roughly twice an hour per issue rather than every poll — and the moment any worker ships, which is positive proof the project has branches, every cooldown is released at once. Three cap failures in a row still trip the circuit breaker. The `[OUTCOME]` line reads `triage=CAP`, and a cooling-down issue logs `[SKIP] HON-XX requeued at the Neon branch cap`.

The cooldown expires rather than lasting the run on purpose. A run-scoped suppression wedges: its only other release is a successful run, which needs a worker, which needs a candidate the suppression has just hidden — so once the Queued page had been walked the orchestrator would idle until restarted, and freeing branches with `wt cleanup` would recover nothing.

The cap message itself names the budget, the ceiling in force and the branch count before and after the orphan GC, so the next reader can tell a misconfigured ceiling from a project full of branches nothing owns.

### Monitoring

**Live status:** Run `wt status` from any terminal to see orchestrator state, worker phases, elapsed times, and git progress, plus a line when the main checkout is behind `origin/main` for orchestrator code ([Updating the orchestrator](#updating-the-orchestrator)).

**Live dashboard:** `wt watch [interval]` (default 5s) is the full-screen version, and shows four things `wt status` does not:

| Region              | What it answers                                                                                                                                                                  | Source                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ORCHESTRATOR` pane | Is it alive, how long has it been up, how stale is the last poll, is the circuit breaker paused (with the remaining countdown)                                                   | `orchestrator-status.json`                                                                  |
| `THIS RUN` pane     | What this run has produced — merged / failed / stranded / gated / timeout counts, the last `[OUTCOME]` in full, the last issue claimed, and how many issues were skipped and why | `[OUTCOME]`, `Selected:` and `[SKIP]` lines in `orchestrator.log`, windowed to `started_at` |
| Worker table        | Per worker: phase, elapsed, commits, **PR number and CI bucket**, and the issue title                                                                                            | status file + cached `gh` probes                                                            |
| `RECENTLY LANDED`   | Which PRs have merged recently, newest first                                                                                                                                     | `gh pr list --state merged`                                                                 |

Below those, each worker keeps a tail of its Claude activity, with a `●` on any worker whose session advanced since the last redraw. Every worker keeps its slot whether or not it moved — hiding the quiet ones empties the screen exactly when several workers are sitting in a CI wait, which is when you are most likely to be watching.

Six things about that display are worth knowing before you trust it:

- **The `THIS RUN` tallies are scoped to the current orchestrator process**, by windowing `orchestrator.log` at the status file's `started_at`. If the run predates a 50 MB log rotation, the counts are a floor and are labelled `(floor: log rotated)` rather than passed off as totals.
- **In those tallies the number is history and the colour is whether you still have something to do.** `stranded` and `gated` are yellow only while an outcome is unanswered, and then they show the open count. Once every one is answered, the run's total is shown dim with `(resolved)`, a word dropped first when the row would not fit its pane, so the colour survives. A gated outcome is answered by a later `[UNGATE]`, `Claimed` or `[OUTCOME]` line for the same issue. The orchestrator logs `[UNGATE]` when the issue is in Queued without the `Gated` label, and also when it leaves Queued (to Todo, Backlog or Canceled). A stranded one is answered by a later `[OUTCOME]` or `Claimed` for it (the picker never claims a `Stranded`-labelled issue), by its PR being merged or closed, or by its preserved worktree being gone (`wt cleanup`).
- **PR and CI state come from a background cache, not from the redraw.** A `gh` call costs about a second, so probing three workers on every 5s tick would stall the interval it promises; instead a probe runs at most every 30s per worker (120s for the landed pane), the redraw renders whatever the cache holds, and a failed probe keeps the last known value rather than blanking the column. A freshly pushed branch therefore shows `…` in the `PR` column for one tick.
- **There is no "next issue" on the dashboard, because there is none on disk.** The candidate list never leaves the `jq` expression inside `select_next_issue`, so the pane reports the last issue _claimed_ (`last claim`) and the skip histogram — never a prediction. When a slot sits empty, the reason is the `⚠` alert line, which surfaces the most recent blocker (`Pausing: low disk space`, `Failed to fetch issues from Linear`, the queue query cap) and is suppressed once a later claim or completion proves the orchestrator recovered from it. The blockers that only explain an _unfilled_ slot (Linear, the circuit breaker, the queue query cap, a Neon-cap worktree failure) also disappear while every slot is busy — there is no slot to explain, and a full orchestrator claims nothing, so the recovery rule could never clear them. `Low disk space` stays up regardless — it bites the workers already running, and since HON-716 the orchestrator checks the disk on every poll rather than only when it is about to spawn, so the warning actually reaches a busy orchestrator.
- **On a short terminal the log tails are what give, and then the landed pane — never the summary.** The panes print first, so an overrun scrolls them off the top, which would cost the health readout to buy a log tail. `watch_height_budget` allocates instead: the summary, the worker table, one separator per worker and a 2-line floor under each tail are mandatory; what is left goes to `RECENTLY LANDED`, up to six rows; what is left after that lengthens the tails toward 14 lines. With three workers the untrimmed layout needs 65 lines, and from there the tails shrink first — at 29 lines you still get all six landed rows with 2-line tails. Below 29 the pane starts giving up rows, below 24 it goes entirely, below 21 the tails drop to one line, and below 18 the activity section is dropped whole (separators included) and the pane gets that room back. A 24-line tmux pane therefore shows the summary, the table and one landed row. Only below 12 lines does the mandatory part stop fitting and the terminal scroll — at that point there is nothing left to trim.
- **The size it budgets against comes from `stty size`, not `tput`.** macOS `tput lines` / `tput cols` report the terminfo entry's static 24x80 and consult only `$LINES` / `$COLUMNS`; they never ask the terminal. The dashboard was therefore sizing itself to a terminal that was not there — a 17-row tmux pane read as 24 rows, a 100-column one as 80 — which is most of why the panes scrolled off a short pane. `watch_term_size` asks the kernel, and falls back to `$LINES` / `$COLUMNS` and then to 40x100 when there is no terminal to ask, which is what keeps the layout assertable from a test.

Use `watch -n 5 wt status` if you want the terse one-screen version in a pane instead.

Commit counts and the git-heuristic phases derived from them — in `wt status`, `wt watch`, the `[OUTCOME]` lines and the Linear comments — are measured against `origin/main` as last fetched, which is the ref autonomous worktrees are cut from. Your local `main` never affects them, so you do not need to `git pull` in the primary checkout to keep those honest (HON-601). `wt cleanup` and `wt cleanup-all` are the exception: they still measure against local `main`, so on a checkout you have not pulled they can report `unpushed commits` for a worktree `wt status` shows as empty.

**macOS notifications:** Desktop notifications fire automatically when a worker succeeds or fails, showing the issue ID, outcome, duration, and phase.

**Structured outcome logging:** Every worker completion logs a parseable `[OUTCOME]` line to `orchestrator.log`:

```
[OUTCOME] HON-51 SUCCESS 35m0s 4-commits phase=done
[OUTCOME] HON-53 TIMEOUT 1h1m 2-commits phase=reviewing triage=RETRY
[OUTCOME] HON-55 GATED 8m0s 0-commits phase=planning
[OUTCOME] HON-570 STRANDED 12m3s 3-commits phase=pr-review pr=#650 ci=green exit=clean
[OUTCOME] HON-580 STRANDED 1h0m 4-commits phase=pr-review pr=#667 ci=green exit=timeout
[OUTCOME] HON-611 STRANDED 1h45m 3-commits phase=pr-review pr=#701 ci=failing exit=error
[OUTCOME] HON-640 STRANDED 52m10s 5-commits phase=pr-review pr=#712 ci=green exit=clean triage=FINISH
[OUTCOME] HON-609 FAILED 0m8s 0-commits phase=planning triage=CAP
```

`SUCCESS` is logged only for a run that reached `phase=done` — i.e. actually merged, or confirmed merged against its PR. Every other exit that shipped something is `STRANDED`; one that shipped nothing is `GATED` (clean exit) or `TIMEOUT` / `FAILED` (killed or crashed with no PR). A `FAILED` line carrying `triage=CAP` is the one shape that is not the issue's fault — the Neon branch cap was hit during worktree setup, so the issue went back to Queued rather than Backlog (see the Configuration section above).

**Stranded runs.** A worker can end with commits and an open, unmerged PR. That is an incomplete cycle, not a success: the merge never happened and the issue parks in In Review. `exit=` says which signal ended it — `clean` for an exit-0 worker, `timeout` for one killed at `WORKER_TIMEOUT`, `error` for one that exited non-zero, `stopped` for a finish attempt that a force stop killed (below). A first strand usually gets one automatic finish attempt (below); what follows is what happens when it does not, or when the finish attempt strands too. The orchestrator logs `STRANDED` with the PR number and its CI state (`green` / `pending` / `failing` / `unknown`), comments on the Linear issue with the PR URL and worker log path, adds the `Stranded` label — and **skips cleanup entirely**, so the worktree, local git branch and paired Neon branch all survive. Those artifacts are what finishing the run by hand requires:

```bash
gh pr merge --squash <PR>          # ci=green — one step from done
wt resume <branch>                 # ci=failing/pending — pick the work back up
wt cleanup <branch>                # ALWAYS, once finished — release the artifacts
```

The release step is not optional. Nothing else reclaims a preserved worktree (a full `pnpm install`), and `wt auto` hard-exits when one already exists — so an unreleased worktree blocks every future run on that branch. The `Stranded` label is what keeps the picker off the issue until you have done it: `select_next_issue` skips `Stranded` exactly as it skips `Gated`, so remove the label only after `wt cleanup`.

**One automatic finish attempt comes first (HON-1065).** Most strands are one merge from done: of the 12 between 2026-09-02 and 2026-10-05, 6 had `ci=green`. So on an issue's first strand, `strand_worker` respawns the run once instead of asking you. The outcome line ends in `triage=FINISH`, and the orchestrator then does what the `RETRY` path does: it removes the worktree but keeps the git branch and the Neon branch, and spawns a new worker on the same branch. Its retry context names the phase, the PR number and the CI state, and tells it to finish: fix CI if it fails, then merge. `/auto-implement` resumes at 6.1 when an open PR is on the branch (`.claude/skills/auto-implement/recovery.md` → Retry context). The issue gets no `Stranded` label and no comment, and its Linear state is left alone. The attempt still counts toward the circuit breaker, and `wt watch` tallies the strand but does not list it as waiting on you. If `wt stop` force-drains while the finish attempt runs, the drain records the strand for you: `STRANDED … exit=stopped`, the `Stranded` label and the comment, with the worktree, branch and Neon branch kept (HON-1077). With a PR the issue stays In Review; with no PR it goes back to Queued, unassigned, and the `Stranded` label keeps the picker off it. A finish attempt whose PR merged before the kill is drained as usual.

The finish attempt runs only when all of these hold. Otherwise the strand is recorded for a human, as described above:

- It is the issue's first attempt. A second strand, after the finish attempt or after a `RETRY`, waits for you.
- The orchestrator is not shutting down.
- The PR probe ran, so `gh` answered.
- The PR is `OPEN`, or there is no PR and the branch has commits. A `CLOSED` PR does not qualify, because someone may have closed it on purpose.
- The worktree has no uncommitted changes. The cleanup runs `git worktree remove --force`, which would lose them.
- The worker did not stop at `/auto-implement`'s 6.7 review-round cap hand-off. That stop leaves the PR for a human on purpose, because a correctness finding is unresolved. The orchestrator reads the hand-off line in the worker log: `[auto-implement] PR left open`, or a `[auto-implement] ⚠` line that says `Review-round cap reached` or `handing off`.

If no PR could be resolved at all — none was opened, or `gh` is missing or unauthenticated — Linear never moved the issue anywhere, so it is still `In Progress` and assigned where `claim_issue` left it. That path returns the issue to Queued and clears the assignee (as the gated path does), leaving the `Stranded` label as the gate. A PR in any other state is left alone: `In Review` is the accurate state when a PR exists. A `CLOSED`-but-unmerged PR is reported as such and told to reopen rather than merge — `gh pr merge` on a closed PR fails.

Before deciding a run is stranded, the orchestrator re-checks the PR: a `MERGED` PR is reported as `SUCCESS` even if the phase marker was missing, so a lagging `detect_phase` cannot manufacture a false stranding. Without `gh` on `PATH`, or with a `gh` that errors or is rate limited, the PR cannot be checked at all, and the run is reported `STRANDED` without PR detail — the conservative answer on the exit-0, timeout and error-exit paths alike, since a false verdict deletes the branch either way. Like `GATED`, a stranded exit counts toward the circuit breaker.

The usual cause is a worker that ended its turn waiting on something: in the headless spawn the process exits when a turn ends, so a backgrounded CI poll dies with it. `/auto-implement`'s Execution Model forbids that (foreground wait-chunks instead) — a fresh `STRANDED exit=clean` line means either that rule was broken or the worker hit a real stop.

**Timeouts and error exits are stranding-checked.** A worker killed at `WORKER_TIMEOUT`, or one that exits with a non-zero code, is _not_ automatically a failure. Because `/auto-implement` waits for CI in the foreground, the most likely thing a worker is doing when the clock runs out is watching a finished, green PR. A crash can come after the commits or the PR as well. So the orchestrator probes for a PR before triaging, on both paths (`handle_timeout` and `handle_error_exit`):

| State when the worker ended      | Outcome                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| PR merged                        | `SUCCESS` — the cycle finished, the kill or crash landed after the merge                             |
| PR open or closed, unmerged      | `STRANDED exit=timeout` / `exit=error` — artifacts preserved, exactly as an exit-0 stranding         |
| No PR, but commits on the branch | `STRANDED exit=timeout` / `exit=error` — the same state the exit-0 path preserves                    |
| `gh` could not answer            | `STRANDED exit=timeout` / `exit=error` — silence is not evidence, and this is the destructive branch |
| No PR and no commits             | `TIMEOUT` or `FAILED` — a genuine stall or crash, triaged and possibly retried as before             |

Only the last row reaches `handle_failure`, and that matters: its `BACKLOG`, `NEEDS_HUMAN` and already-retried `RETRY` arms all end in a cleanup that runs `git branch -D` and deletes the paired Neon branch, so anything not yet pushed dies with them. A Neon cap death happens before Claude runs, so it has no PR and 0 commits. It reaches the `CAP` arm even when `gh` cannot answer, because the orchestrator reads the cap from the worker log ahead of the PR probe. Before this check existed, every row went to triage: three finished, green PRs (#650, #667, #669) were reported as failures and their issues pushed to Backlog with `Needs attention` while the PRs sat open (HON-573, HON-583). The non-zero exit kept that behaviour until HON-1064, which is how HON-611 and HON-362 lost their branches on 2026-09-07. A `STRANDED exit=timeout` line means the work is probably done and just needs a merge — check the PR before re-running anything. A `STRANDED exit=error` line means the worker crashed: the Linear comment names the exit code, so read the worker log before you resume. A crash with commits gets no `RETRY` triage. Like any other stranding, it gets the one finish attempt and then waits for you. The commit count does not depend on the worktree: a respawn (`RETRY` or the finish attempt) removes the worktree and keeps the branch, so a respawn that dies before `wt auto` re-creates the worktree is counted from the kept branch in the main checkout. Only a branch that is gone too counts as 0 commits. Such a strand has no worktree, so the orchestrator re-creates it from the kept branch before it records the strand: `wt resume` and `wt cleanup` need it, and `wt watch` reads a missing worktree as resolved (HON-1077).

The 3-hour default budget exists for the same reason: waiting for CI in-turn costs 8–12 minutes on top of the implementation, and the previous 1-hour cap killed every run that needed longer at exactly the point it was about to merge. Lower it with `--worker-timeout` if you want faster failure on stuck workers, but not below about 90 minutes.

A worker can also exit cleanly but make no commits. Such a worker ships nothing, so the orchestrator logs `GATED`, not `SUCCESS`. It comments on the issue, adds the `Gated` label, and — if the issue is still `In Progress` — returns it to Queued and clears the assignee. Without this step, the issue stays `In Progress` and assigned, and the picker skips it forever. A gated exit counts toward the circuit breaker like any other failure.

The picker skips any Queued issue carrying the `Gated` label (`[SKIP] HON-XX gated …`), and also skips issues gated earlier in the same run in case the label write failed: the issue is back in Queued and unassigned, so without that skip the next poll — or the next restart — would re-pick it and respawn the same no-op worker in a loop. Fix the cause, then remove the label (or re-triage) to make it pickable again.

Filter with `grep '\[OUTCOME\]' ~/.worktrees/wobblepot/logs/orchestrator.log`.

### Logs

All logs are written to `~/.worktrees/wobblepot/logs/`:

| File                          | Contents                                           |
| ----------------------------- | -------------------------------------------------- |
| `orchestrator.log`            | Main loop activity, claims, triage, outcomes       |
| `orchestrator-console.log`    | Output that never reaches `log()`: crashes, aborts |
| `worker-HON-XX-TIMESTAMP.log` | Full output from each `wt auto` worker             |

The machine-readable status that `wt status` reads, `orchestrator-status.json`, sits one level up, in `~/.worktrees/wobblepot/`.

`orchestrator.log` has exactly one writer — the script's own `log()` — so each line appears once, clean, with no ANSI escapes. `wt start` sends the process's stdout/stderr to `orchestrator-console.log` instead of folding them back into the same file, which used to store every line twice, once escape-wrapped (HON-572). `log()` writes its coloured copy to stderr only when stderr is a terminal, so under `wt start` the console log holds only output that never reaches `log()`: crashes, `set -e` aborts and stray command errors (HON-1068). A start-up abort is one of those, so the console log is where to look when `wt start` reports a failure.

At start-up, `rotate_logs` moves a log past 50 MB (`ORCHESTRATOR_LOG_MAX_BYTES`) to `.1`, keeping one backup. `orchestrator.log` is renamed. `orchestrator-console.log` is copied and then emptied, because the running process holds it open and would otherwise keep writing into the `.1` copy. Worker logs older than 14 days are deleted.

The orchestrator logs an idle poll only when it differs from the previous one: the `Polling: N/M workers active` line, and `No eligible issues found` after it, appear when the worker count or the poll's outcome changes, and again after a pass that did not poll (slots full, circuit breaker, low disk). An unchanged queue writes them once. The `── Active workers ──` rows follow the same rule per worker: a row is written when its phase or commit count changes, and otherwise every 10 minutes. Liveness does not depend on these lines: `wt watch` reads `last_poll` from `orchestrator-status.json`, which updates on every poll.

### Graceful Shutdown

- First `SIGINT`/`SIGTERM` → stops spawning, waits for running workers
- Second signal → force kills all workers immediately, then drains: each worker's issue goes back to Queued unassigned before the orchestrator exits

The signal handler only sets flags; the main loop does the waiting and the drain. A handler that ran the wait loop itself could not see the second signal, because bash does not re-enter a handler that is still running (HON-1067). A signal that arrives during a Linear call or a triage call is acted on when that call returns.

`wt stop` sends both signals for you and then waits for the drain to finish rather than SIGKILLing on a fixed timer. While it waits it re-sends `SIGTERM` every 5s: bash runs a trap once for any number of the same signal that arrive during one foreground command, so two signals that both land inside one triage call count as one. The wait scales with the work: `2 × TRIAGE_TIMEOUT + max(60s, 15s × active workers)`. The triage part (`ORCHESTRATOR_TRIAGE_TIMEOUT`, 120s by default) covers two triage calls: one in flight when both signals land and count as one, and the next failed worker's call, which can start before a re-sent signal arrives. Once the second signal is set, the orchestrator triages no further workers and drains them instead. `wt stop` reads both the worker count and the triage timeout from `orchestrator-status.json`, with the 60s floor and its own environment's triage timeout used whenever that file is missing or unreadable. Killing partway through the drain is what orphans `claude` processes and strands their issues `In Progress` **and assigned** — the state the picker skips forever.

The poll loop sleeps via `interruptible_sleep` (a backgrounded `sleep` plus `wait`) so the first signal is acted on within a second. A plain foreground `sleep "$POLL_INTERVAL"` blocks trap delivery for up to 60s, which is longer than the 15s `wt stop` allows before escalating.

### Updating the orchestrator

A merged orchestrator change takes effect once the main checkout the orchestrator runs from has been pulled and its running workers have finished. It does not need a restart (HON-861).

- **Reload.** Every poll, the orchestrator compares a checksum of `scripts/orchestrator.sh` (and of any file it sources, listed in `ORCHESTRATOR_CODE_FILES`) with the one it started on. It only acts on a change that is committed on `main`: tracked, unmodified and checked out on `main`. The main checkout is also your working copy, so a half-finished edit or another branch checked out there never goes live unattended. It logs one `INFO … is not committed on main; not reloading it` instead, and keeps claiming.
- **Drain, then exec.** A committed change that passes `bash -n` is loaded in two steps:
  1. While workers are running, it logs `INFO … claiming nothing new until N running worker(s) finish, then reloading` and stops claiming. Per-worker bookkeeping lives only in memory, and the loop refills a freed slot in the same poll, so without the pause a busy queue would never let it go idle.
  2. On the first poll with no worker, it logs `INFO Orchestrator code changed on disk (… -> …); reloading in place` and `exec`s the script with its original flags. The PID stays the same, so `orchestrator.pid`, `wt status`, `wt stop` and the console log are unaffected.
- **State carries over.** The circuit breaker (failure count and pause), the gated and cap-cooldown suppressions, the run's start time and the last behind-`origin/main` WARN are handed to the new image, so a reload changes code, not state. After a reload, an environment check that fails (typically a Linear blip) is retried every poll interval rather than ending the process.
- **What never reloads.** A change that fails `bash -n` is not loaded: the orchestrator logs one `WARN … fails bash -n` for that version and keeps running (and claiming) on the old code. `--once` runs never reload.
- **Behind `origin/main`.** Nothing pulls the checkout for you, because it is also your working directory. At most every 10 minutes, whether or not workers are running, the orchestrator fetches `origin/main` into a ref of its own, `refs/orchestrator/origin-main`. It never updates `origin/main` itself, which the workers fetch into the same `.git`. Every poll it counts the commits to `scripts/orchestrator.sh` and `scripts/worktree-claude.sh` that the checkout lacks: those are the only two scripts that run from it, since workers run everything else from their own fresh worktrees. The fetch runs with SSH in `BatchMode`, so an unloaded key fails the fetch instead of prompting. When there are any, it logs one `WARN Checkout is behind origin/main …` per new `origin/main` SHA and records the counts in `orchestrator-status.json`. `wt status` prints them, and `wt watch` shows them on its `⚠` line whenever no operational alert needs that line. Because the counts are recomputed every poll, the notice clears on the next poll after you pull. `worktree-claude.sh` runs from the same checkout, so until you pull, the workers the orchestrator spawns also run the old code.

So after an orchestrator PR merges, `git pull` on `main` in the main checkout is the whole procedure.

### Design: Dumb Dispatcher, Smart Workers

The orchestrator is deliberately simple — a bash loop with curl + jq. All intelligence lives in the workers (`/auto-implement`). This means zero API cost for the dispatch loop, predictable behavior, and the ability to run for days.

## wt commands

`wt` is `scripts/worktree-claude.sh`. Add an alias to `~/.zshrc` or `~/.bashrc`:

```bash
alias wt='~/Projects/wobblepot/scripts/worktree-claude.sh'
```

Every subcommand loads `.env` first (see [Untracked Files](#untracked-files)).

| Command                                | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wt start [flags]`                     | Starts the orchestrator in the background. Flags pass through unchanged ([Configuration](#configuration)). Refuses if one is already running                                                                                                                                                                                                                                                                                                                                                                                            |
| `wt stop`                              | Stops the orchestrator and waits for the drain ([Graceful Shutdown](#graceful-shutdown))                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `wt watch [interval]`                  | Full-screen dashboard, redrawn every `interval` seconds (default 5) ([Monitoring](#monitoring))                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `wt status [-v]`                       | One-shot orchestrator and worker summary. `-v` (or `--verbose`) adds, per worker, the changed files, the uncommitted diff stat, the last five commits and the PR URL                                                                                                                                                                                                                                                                                                                                                                    |
| `wt logs <issue\|branch> [lines]`      | Prints a worker's recent Claude activity from its session transcript. Takes `HON-373`, `373` or a branch name; `lines` is a message count (default 20)                                                                                                                                                                                                                                                                                                                                                                                  |
| `wt new <branch> [--fresh-db]`         | Creates a worktree and its Neon branch, then opens interactive Claude Code in it. `--fresh-db` recreates the Neon branch ([Per-Worktree Database Isolation](#per-worktree-database-isolation))                                                                                                                                                                                                                                                                                                                                          |
| `wt auto [issue\|branch] [--fresh-db]` | Creates a worktree and runs `/auto-implement` headless. Takes a Linear branch name, `HON-51` or `51` (branch `auto/hon-51`), or nothing (the skill picks from `Queued`). This is what the orchestrator spawns                                                                                                                                                                                                                                                                                                                           |
| `wt resume <branch>`                   | Reopens the last Claude Code session (`claude --resume`) in an existing worktree                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `wt list`                              | Lists the worktrees under `~/.worktrees/wobblepot/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `wt sync <branch>`                     | Copies the permissions a worktree's sessions approved (`permissions.allow` in `.claude/settings.local.json`) into the main checkout's copy of that file                                                                                                                                                                                                                                                                                                                                                                                 |
| `wt sync-all`                          | `wt sync` for every worktree                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `wt cleanup <branch>`                  | Asks, with a warning when the branch has unmerged work, then syncs permissions, removes the worktree and its Neon branch, and offers to delete the git branch. Refuses to remove the worktree you are standing in                                                                                                                                                                                                                                                                                                                       |
| `wt cleanup-all`                       | Lists every worktree as merged or not, then removes the merged ones, or all of them after a typed `yes`. Run it from the main checkout                                                                                                                                                                                                                                                                                                                                                                                                  |
| `wt done`                              | After a merge: pulls `main` in the main checkout, removes each worktree whose branch is merged and clean, then deletes merged local branches, squash merges and `gh pr checkout` `pr<N>` branches included. A squash-merged branch, and its worktree, go only when the tip equals the merged PR's head; otherwise they stay with a WARN. When `gh` fails, no worktree is removed and only regular merges are pruned. Skips orchestrator workers. From inside a worktree it removes that worktree only when merged, then prints the `cd` |
| `wt neon-delete <branch>`              | Deletes the Neon branch paired with a git branch, without prompting. For scripts (the orchestrator calls it); refuses protected names and does nothing when Neon is not configured                                                                                                                                                                                                                                                                                                                                                      |
| `wt help`                              | Prints the usage summary (also `-h`, `--help`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Running one worktree by hand

Outside the orchestrator you can run a worktree yourself: to work interactively on a branch, to watch one issue run unattended, or to pick up a stranded run.

```bash
wt new feat/my-feature                  # interactive Claude Code in a new worktree
wt auto kaupokorv/hon-51-feature-name   # /auto-implement on the issue's Linear branch name
wt auto HON-51                          # same, by issue ID (branch auto/hon-51)
wt resume feat/my-feature               # reopen the session in an existing worktree
wt cleanup feat/my-feature              # remove the worktree and its Neon branch
wt done                                 # after the merge: prune merged worktrees and branches
```

**`wt auto` with an issue skips the queue's filters.** An explicit issue ID or branch reaches `/auto-implement` as an argument, and that path skips its no-human-input filters (step 1.5): passing the issue is your call that it can run unattended. The status, assignee and blocker gate (step 2.1) still applies. With no argument, `wt auto` picks from `Queued`, as the orchestrator does.

- **Use the Linear branch name.** `wt auto kaupokorv/hon-51-…` names the branch so Linear links the PR to the issue. `/next-issue` prints a ready-to-paste `wt auto <branch>` line per candidate.
- **A hand-run worktree holds a Neon branch** from the same cap as the orchestrator's workers ([Branch budget](#branch-budget)). Running one beside a full orchestrator can push the next worker over it.
- **A common split** is planning and review in the main checkout while a `wt new` worktree carries out the plan.
- **Clean up** with `wt done` once the PR has merged, from the worktree or the main checkout. `wt cleanup <branch>` removes one worktree whatever its state.

## Swapping models

The workflow runs on three models, set in `scripts/models.sh` (HON-730): `AUTO_MODEL` for the `wt auto` worker, `REVIEW_MODEL` for the PR reviewer, and `TRIAGE_MODEL` for the orchestrator's failure triage. Each takes an override from its `CLAUDE_*_MODEL` env var ([Configuration](#configuration)). These are the workflow's models; the app's own AI calls have their own models and benchmark ([AI_MODELS.md](AI_MODELS.md)).

**Changing a default is a human decision, made on a swap test's results.** An agent does not change one as part of other work.

**The reviewer and the implementer share a model today.** Both default to `claude-opus-5-5`, so the reviewer has the implementer's blind spots: whatever the model gets wrong while writing, it is likely to accept while reviewing. CI and the human who reads the PR are the only checks outside that model. Weigh this when changing either default.

### The swap test

Run it when a new model ships, before changing a default. It answers one question: does the workflow ship as well on the new model as on the current one?

1. **Pick 2–3 issues from different areas**: one UI change, one API route, one orchestrator or other script. A model that is better at React can be worse at bash.
2. **Run them on the candidate model.** Change one model at a time. To test the implementer, leave `CLAUDE_REVIEW_MODEL` alone so the review findings stay comparable:

   ```bash
   CLAUDE_AUTO_MODEL=<candidate> wt auto HON-NNN            # one issue
   CLAUDE_AUTO_MODEL=<candidate> wt start --max-workers 1   # or the next Queued issues (wt stop first)
   ```

   `wt` re-exports `.env` over the shell, so a `CLAUDE_AUTO_MODEL` line in `.env` beats the one on the command line. Remove it for the test.

3. **Compare each PR against comparable merged PRs from the same area on the current model**, on these numbers:

   | Measure              | Where to read it                                                                                                                                                    |
   | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | CI passed first time | The first push's checks on the PR; a `fix: Address CI failures` commit means it did not                                                                             |
   | Review findings      | Inline review comments plus the findings in each `<!-- claude-review -->` summary, per round                                                                        |
   | Fix-up commits       | Commits after the first push (`fix: Address CI failures`, `fix: Address review feedback`)                                                                           |
   | Time to merge        | The `[OUTCOME]` line's duration in `orchestrator.log`, or PR open to merge for a hand run                                                                           |
   | Outcome              | The `[OUTCOME]` result: `SUCCESS`, or `STRANDED`, `GATED`, `FAILED` or `TIMEOUT`. A `GATED` run also labels the issue `Gated`; remove the label before the next run |
   | Token cost           | `pnpm agent-cost` (`scripts/agent-cost-per-pr.ts`), per PR                                                                                                          |

4. **Record the results before changing the default**: a table in a comment on the Linear issue that makes the change, with the PR numbers, so the decision can be checked later.

**Replaying an issue that has already merged is not possible yet.** It would be the fairer comparison, since the same issue runs on both models, but `wt auto` always branches from `origin/main`, which already has the change, `/auto-implement` stops on a Done issue (step 2.1), and a full cycle ends by merging. Until replay is supported, the test runs on new issues and compares them with similar merged ones, so read one-PR differences as noise and look for a pattern across the 2–3.

## Worktree Location

All parallel worktrees are created in `~/.worktrees/wobblepot/<branch-name>` to keep the project directory clean. A `/` in the branch name becomes `--` in the directory name (`feat/x` → `feat--x`).

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

When the Neon project hits its branch cap (10 on the free tier), `wt` automatically runs an orphan GC (deletes Neon branches whose git worktree no longer exists, and orphaned `preview/*` branches — see the reaper table below) and retries once. If still over cap, it fails loud — no silent fallback to the shared DB.

A create failure only reaches that path if it looks like exhaustion and _nothing else_. `neon_classify_create_error` strips the branch name out of the error text, then tests `already exists` / `duplicate` first, and reaches a `cap` verdict only when the word `branch` and one of `limit` / `quota` / `cap` / `exceed` / `maximum` appear on the **same line**. All three parts matter, because the keyword test is bare substring matching:

- Without the strip, a branch whose slug carries one of those words — `kaupo--hon-580-…-silent-queue-cap-dead-code-stale`, say — reads as a capacity problem. That cost HON-580 the reuse path its RETRY depended on, and reported a full project that held 6 branches out of 10 (HON-581).
- Without the ordering, the same name shadows the unambiguous `already exists` signal underneath it.
- Without the same-line requirement, `Rate limit exceeded`, `insufficient capacity`, even `invalid escape sequence` (es-**cap**-e) call the GC. That is not a harmless sweep: it deletes every Neon branch with no live worktree, project-wide, and a RETRY parks exactly that shape — `cleanup_worker_worktree "$branch" true` removes the worktree and keeps the branch for the respawn. One worker's rate limit must not be able to destroy another worker's retry database.

An `already exists` error is not a failure when the git branch is being resumed: `wt auto`'s retry path passes `reuse_existing=1`, and the deliberately-preserved Neon branch is reused as-is. Outside that path it is still a hard stop — use `--fresh-db` to recreate. `--fresh-db` never falls back to reuse: its pre-delete silences errors, so a branch that still exists afterwards means the delete did not take, and reusing it would hand back the exact database you asked to destroy.

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
| `neon-cleanup.sh sweep`             | Daily cron / manual dispatch                                | All of the above **plus** the linked Linear issue being Done/Canceled and age > 24h                                             |

`preview/<ref>` branches — the Vercel–Neon integration's, not ours — go through a separate gate in `neon_gc_orphans` and `sweep` (never `delete-for-branch`): `<ref>` is gone from `origin`, no open PR has it as its head, the branch is not `default`/`protected`/allowlisted, and (sweep only) it is older than 24h. Any `git` or `gh` failure keeps the branch. The integration re-creates these after a PR has merged (HON-852); see [`docs/RUNBOOKS/neon-branch-gc.md`](./RUNBOOKS/neon-branch-gc.md) → "`preview/*` is not ours".

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
