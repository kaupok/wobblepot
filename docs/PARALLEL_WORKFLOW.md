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
alias wt='~/Projects/honkadori/scripts/worktree-claude.sh'
```

Then use `wt new feat/my-feature` from anywhere.

## Best Practices

1. **Use `/next-issue` first** - Get 3 candidates with ready-to-copy commands before spawning worktrees
2. **Use branch names from Linear** - `wt auto kaupokorv/hon-51-...` creates properly named worktrees
3. **Clean up regularly** - Run `wt cleanup-all` to remove merged worktrees
4. **Check status** - Run `wt list` or `./scripts/worktree-status.sh` for dashboard view

## Worktree Location

All parallel worktrees are created in `~/.worktrees/honkadori/<branch-name>` to keep the project directory clean.

## Untracked Files

When creating a worktree, the script automatically copies these gitignored files from the main repo:

| File                          | Purpose                                              |
| ----------------------------- | ---------------------------------------------------- |
| `.env`                        | Environment variables (DATABASE_URL, API keys, etc.) |
| `.claude/settings.local.json` | Claude Code permissions and settings                 |

`PROJECT_ROOT` paths in these files are automatically updated to point to the worktree location.

**To add more files:** Edit the `UNTRACKED_FILES` array in `scripts/worktree-claude.sh`.

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
- Check `blockedBy` — unblocked if all blockers are Done/Canceled/Duplicate
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

### Logs

All logs are written to `~/.worktrees/honkadori/logs/`:

| File                          | Contents                                   |
| ----------------------------- | ------------------------------------------ |
| `orchestrator.log`            | Main loop activity, claims, triage results |
| `worker-HON-XX-TIMESTAMP.log` | Full output from each `wt auto` worker     |

### Graceful Shutdown

- First `SIGINT`/`SIGTERM` → stops spawning, waits for running workers
- Second signal → force kills all workers immediately

### Design: Dumb Dispatcher, Smart Workers

The orchestrator is deliberately simple — a bash loop with curl + jq. All intelligence lives in the workers (`/auto-implement`). This means zero API cost for the dispatch loop, predictable behavior, and the ability to run for days.
