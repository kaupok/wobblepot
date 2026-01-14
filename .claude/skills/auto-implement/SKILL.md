---
name: auto-implement
description: Fully autonomous implementation cycle for a single Linear issue - finds issue, plans, implements, reviews, fixes, creates PR, addresses feedback, and merges.
context: inherit
---

# Auto-Implement

Fully autonomous development cycle that orchestrates existing skills: find issue → plan → implement → review → fix → create PR → address reviews → merge.

## Usage

```
/auto-implement              # Find next unblocked issue automatically
/auto-implement HON-51       # Use specified issue (skip issue discovery)
/auto-implement 51           # Same as above (HON- prefix optional)
```

## Critical: Autonomous Continuation

**YOU MUST CONTINUE THROUGH ALL 7 PHASES WITHOUT STOPPING.**

After EVERY phase completes, you MUST:

1. Output the phase completion message
2. Output the next phase start message
3. Invoke the next phase immediately

**The ONLY valid stopping points are:**

- Phase 0: Pre-check failures (not on main, uncommitted changes)
- Phase 1: No unblocked issues found
- Phase 4: Fix attempts exhausted after 3 tries
- Phase 6: CI failing after fix attempts
- Phase 7: Successful merge (workflow complete)

**NEVER stop after:** Phase 1 success, Phase 2, Phase 3, Phase 5, or Phase 6 success.

**NEVER ask the user:** "Should I continue?", "Ready for next phase?", or similar. Just proceed.

Each phase below ends with `→ NEXT:` telling you exactly what to do. Follow it.

## Argument Parsing

Check if an issue ID was provided as argument:

- If argument matches `HON-XX` or just `XX` (numbers): Store issue ID, skip Phase 1
- If no argument: Run Phase 1 to find next unblocked issue

## Phase 0: Initialization

### 0.1 Check branch state

```bash
git branch --show-current
```

If NOT on `main`:

```
[auto-implement] ✗ Error: Not on main branch. Switch to main before running /auto-implement
```

Stop here.

### 0.2 Check for uncommitted changes

```bash
git status --porcelain
```

If output is not empty:

```
[auto-implement] ✗ Error: Uncommitted changes detected. Commit or stash before running /auto-implement.
```

Stop here.

### 0.3 Report start

```
[auto-implement] Starting autonomous implementation cycle
```

## Phase 1: Get or Find Issue

**If issue ID was provided in arguments:**

```
[auto-implement] Phase 1/7: Using specified issue HON-XX
```

Skip to Phase 2.

**If no issue ID provided:**

```
[auto-implement] Phase 1/7: Finding next issue
```

Invoke the `/next-issue` skill:

```
Skill({ skill: "next-issue" })
```

Extract the recommended issue ID from the output (look for "Recommended: HON-XX").

If no unblocked issues found:

```
[auto-implement] ✓ No unblocked issues found. Nothing to implement.
```

Stop here (normal exit).

Store the issue ID for subsequent phases.

```
[auto-implement] ✓ Selected: HON-XX - [Title from output]
```

→ **NEXT:** Immediately invoke Phase 2 (plan-issue with --auto).

## Phase 2: Plan Implementation

```
[auto-implement] Phase 2/7: Planning implementation
```

Invoke the `/plan-issue` skill with `--auto` flag (skips approval prompt):

```
Skill({ skill: "plan-issue", args: "HON-XX --auto" })
```

```
[auto-implement] ✓ Plan posted to Linear
```

→ **NEXT:** Immediately invoke Phase 3 (implement-issue).

## Phase 3: Implement

```
[auto-implement] Phase 3/7: Implementing
```

Invoke the `/implement-issue` skill:

```
Skill({ skill: "implement-issue", args: "HON-XX" })
```

The skill will fetch the plan from Linear, create branch, and implement.

```
[auto-implement] ✓ Implementation complete
```

→ **NEXT:** Immediately invoke Phase 4 (code-review).

## Phase 4: Review and Fix

```
[auto-implement] Phase 4/7: Reviewing changes
```

Invoke the `/code-review` skill:

```
Skill({ skill: "code-review" })
```

Review the output for issues in "Address Now" category.

### 4.1 Fix loop

If there are issues to address:

```
max_attempts = 3
attempt = 0

while issues remain and attempt < max_attempts:
    attempt += 1
    [auto-implement] Fix attempt {attempt}/3

    For each issue in "Address Now":
        - Read the file at the specified location using Read tool
        - Analyze the issue and code context
        - Apply the fix using Edit tool (or Write for new files)
        - If issue spans multiple files, fix all affected files

    # Re-run checks
    pnpm lint && pnpm type-check && pnpm test

    If all pass: break
    If same errors persist: continue with next attempt
```

If still failing after 3 attempts:

```
[auto-implement] ✗ Error: Failed to fix issues after 3 attempts. Manual intervention required.
```

Stop here with failure details.

```
[auto-implement] ✓ All checks passing
```

→ **NEXT:** Immediately invoke Phase 5 (commit --pr).

## Phase 5: Commit and Create PR

```
[auto-implement] Phase 5/7: Creating PR
```

Invoke the `/commit` skill with `--pr` flag:

```
Skill({ skill: "commit", args: "--pr" })
```

This will:

- Stage all changes
- Run pre-commit checks
- Create commit with proper message
- Push and create PR

```
[auto-implement] ✓ PR created: [URL from output]
```

→ **NEXT:** Immediately invoke Phase 6 (wait for CI, then pr-review).

## Phase 6: Wait for Reviews and Address Feedback

```
[auto-implement] Phase 6/7: Addressing reviews
```

### 6.1 Wait for CI

```bash
gh pr checks --watch --interval 10
```

If CI fails, attempt to fix (max 2 attempts):

```
ci_attempts = 0
max_ci_attempts = 2

while CI failing and ci_attempts < max_ci_attempts:
    ci_attempts += 1
    [auto-implement] CI fix attempt {ci_attempts}/2

    - Analyze CI failure output
    - Apply fixes using Read/Edit tools
    - Commit and push: Skill({ skill: "commit", args: "--push" })
    - Wait for CI: gh pr checks --watch --interval 10

If still failing after 2 attempts:
    [auto-implement] ✗ Error: CI checks failing after fix attempts
    Stop here with failure details
```

### 6.2 Get review feedback

Invoke the `/pr-review` skill:

```
Skill({ skill: "pr-review" })
```

This will fetch and triage external review comments into "Address Now" / "Defer" / "Skip" categories.

### 6.3 Address review comments

Parse the "Address Now" section from the `/pr-review` output. For each item (format: `[severity] [description] - path:line - [effort]`):

- Extract the file path and line number
- Read the file at that location using Read tool
- Analyze the comment and apply the suggested fix using Edit tool
- Continue to next issue

Check if any fixes were made:

```bash
git status --porcelain
```

If output is not empty (fixes were made):

```
Skill({ skill: "commit", args: "--push" })
```

Wait for CI again:

```bash
gh pr checks --watch --interval 10
```

```
[auto-implement] ✓ Reviews addressed
```

→ **NEXT:** Immediately invoke Phase 7 (merge).

## Phase 7: Merge

```
[auto-implement] Phase 7/7: Merging
```

Invoke the `/merge` skill:

```
Skill({ skill: "merge" })
```

This will:

- Wait for final CI checks
- Squash merge the PR
- Delete remote and local branches
- Switch to main and pull

```
[auto-implement] ✓ PR merged successfully
[auto-implement] ✓ Autonomous implementation cycle complete
```

## Error Summary

| Phase | Error                  | Action                 |
| ----- | ---------------------- | ---------------------- |
| 0     | Not on main            | Stop with instructions |
| 0     | Uncommitted changes    | Stop with instructions |
| 1     | No unblocked issues    | Stop (normal exit)     |
| 4     | Fix attempts exhausted | Stop, show failures    |
| 5     | Commit/PR fails        | Stop, show error       |
| 6     | CI fails after fixes   | Stop, show failures    |
| 6     | pr-review fails        | Stop, show error       |
| 7     | Merge fails            | Stop, show error       |

## Important

- **NEVER STOP MID-WORKFLOW**: Follow the `→ NEXT:` instruction at the end of each phase
- **Progress reporting**: Output `[auto-implement]` messages between phases
- **Error handling**: Stop cleanly on unrecoverable errors with actionable guidance
