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
