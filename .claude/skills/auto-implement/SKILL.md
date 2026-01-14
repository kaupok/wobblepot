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

## Execution Model

Execute phases sequentially from Phase 0 to Phase 7. Stop only on error or completion.

## Argument Parsing

Check if an issue ID was provided as argument:

- If argument matches `HON-XX` or just `XX` (numbers): Store issue ID, skip Phase 1
- If no argument: Run Phase 1 to find next unblocked issue

## Phase 0: Initialization

### 0.1 Detect environment (worktree vs regular repo)

```bash
git rev-parse --git-common-dir
git rev-parse --git-dir
```

Compare the outputs:

- If they differ → **worktree mode** (branch is managed by worktree)
- If they're the same → **regular repo mode** (must be on `main`)

### 0.2 Check branch state

**Regular repo mode:**

```bash
git branch --show-current
```

If NOT on `main`:

```
[auto-implement] ✗ Error: Not on main branch. Switch to main before running /auto-implement
```

Stop here.

**Worktree mode:**

The worktree branch is the starting point for new work. No branch check needed.

```
[auto-implement] Detected worktree environment
```

### 0.3 Check for uncommitted changes

```bash
git status --porcelain
```

If output is not empty:

```
[auto-implement] ✗ Error: Uncommitted changes detected. Commit or stash before running /auto-implement.
```

Stop here.

### 0.4 Report start

```
[auto-implement] Starting autonomous implementation cycle
```

## Phase 1: Get or Find Issue

**If issue ID was provided in arguments:**

```
[auto-implement] Phase 1/7: Using specified issue HON-XX
```

Store the issue ID.

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

Otherwise, store the issue ID:

```
[auto-implement] ✓ Selected: HON-XX - [Title from output]
```

## Phase 2: Plan Implementation

Output: `[auto-implement] Phase 2/7: Planning implementation`

Invoke: `Skill({ skill: "plan-issue", args: "HON-XX --auto" })`

Output: `[auto-implement] ✓ Plan posted to Linear`

## Phase 3: Implement

Output: `[auto-implement] Phase 3/7: Implementing`

Invoke: `Skill({ skill: "implement-issue", args: "HON-XX" })`

The skill fetches plan from Linear, creates branch, implements code.

Output: `[auto-implement] ✓ Implementation complete`

## Phase 4: Review and Fix

Output: `[auto-implement] Phase 4/7: Reviewing changes`

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

### 4.2 Proceed to Phase 5

Output: `[auto-implement] ✓ All checks passing`

## Phase 5: Commit and Create PR

Output: `[auto-implement] Phase 5/7: Creating PR`

Invoke: `Skill({ skill: "commit", args: "--pr" })`

This stages changes, runs checks, commits, pushes, and creates PR.

Extract PR URL from output.

Output: `[auto-implement] ✓ PR created: [URL]`

## Phase 6: Wait for Reviews and Address Feedback

Output: `[auto-implement] Phase 6/7: Addressing reviews`

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

### 6.4 Proceed to Phase 7

Output: `[auto-implement] ✓ Reviews addressed`

## Phase 7: Merge

Output: `[auto-implement] Phase 7/7: Merging`

Invoke: `Skill({ skill: "merge" })`

This waits for CI, squash merges, deletes remote branch, and cleans up local.

Output: `[auto-implement] ✓ PR merged successfully`
Output: `[auto-implement] ✓ Autonomous implementation cycle complete`

In worktree mode, remind user to clean up worktree when done:

```bash
git worktree remove <worktree-path>
```

## Error Summary

| Phase | Error                           | Action                 |
| ----- | ------------------------------- | ---------------------- |
| 0     | Not on main (regular repo only) | Stop with instructions |
| 0     | Uncommitted changes             | Stop with instructions |
| 1     | No unblocked issues             | Stop (normal exit)     |
| 4     | Fix attempts exhausted          | Stop, show failures    |
| 5     | Commit/PR fails                 | Stop, show error       |
| 6     | CI fails after fixes            | Stop, show failures    |
| 6     | pr-review fails                 | Stop, show error       |
| 7     | Merge fails                     | Stop, show error       |
