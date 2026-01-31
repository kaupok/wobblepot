---
name: auto-implement
description: Fully autonomous implementation cycle for a single Linear issue - finds issue, plans, implements, reviews, fixes, creates PR, addresses feedback, and merges.
context: inherit
---

# Auto-Implement

Fully autonomous development cycle: find issue → plan → implement → review → fix → create PR → address reviews → merge.

All logic is inlined to avoid nested skill context loss ([GitHub #17351](https://github.com/anthropics/claude-code/issues/17351)).

## Usage

```
/auto-implement              # Find next unblocked issue automatically
/auto-implement HON-51       # Use specified issue (skip issue discovery)
/auto-implement 51           # Same as above (HON- prefix optional)
```

## Execution Model

Execute phases 0-7 sequentially. Stop only on error or completion.

## Argument Parsing

Check if an issue ID was provided as argument:

- If argument matches `HON-XX` or just `XX` (numbers): Store issue ID, skip Phase 1
- If no argument: Run Phase 1 to find next unblocked issue

---

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
[auto-implement] Phase 0/7 complete → Proceeding to Phase 1
```

---

## Phase 1: Get or Find Issue

**If issue ID was provided in arguments:**

```
[auto-implement] Phase 1/7: Using specified issue HON-XX
```

Store the issue ID.

```
[auto-implement] Phase 1/7 complete → Proceeding to Phase 2
```

**If no issue ID provided:**

```
[auto-implement] Phase 1/7: Finding next unblocked issue
```

### 1.1 Read project context

```
Read docs/PROJECT_SPEC.md
```

Review for current phase and relevant context.

### 1.2 Search for issues (priority order)

Search in this order, stopping when unblocked issues are found:

**a) Todo/Active issues (highest priority):**

```
mcp__linear-server__list_issues({
  project: "5a19627a-803f-4052-83c4-b44810d17af7",
  state: "Todo",
  limit: 20
})
```

**b) Backlog issues:**

```
mcp__linear-server__list_issues({
  project: "5a19627a-803f-4052-83c4-b44810d17af7",
  state: "Backlog",
  limit: 20
})
```

### 1.3 Check dependencies for candidate issues

For each promising issue, fetch with relations:

```
mcp__linear-server__get_issue({ id: "HON-XX", includeRelations: true })
```

### 1.4 Find unblocked issues

An issue is unblocked if:

- `blockedBy` is empty, OR
- All issues in `blockedBy` have status "Done" or "Canceled"

### 1.5 Prioritize by

- Status: Todo/Active before Backlog
- Dependency order (issues that unblock others first - check `blocks` array)
- Priority field if set

### 1.6 Select issue

If no unblocked issues found:

```
[auto-implement] ✓ No unblocked issues found. Nothing to implement.
```

Stop here (normal exit).

Otherwise, store the issue ID:

```
[auto-implement] ✓ Selected: HON-XX - [Title]
[auto-implement] Phase 1/7 complete → Proceeding to Phase 2
```

---

## Phase 2: Plan Implementation

```
[auto-implement] Phase 2/7: Planning implementation for HON-XX
```

### 2.1 Fetch issue details

```
mcp__linear-server__get_issue({ id: "HON-XX", includeRelations: true })
```

Extract and note:

- Issue UUID (for API calls)
- Title and description
- `gitBranchName` for later use
- `blockedBy` relations (should be empty or done)
- `blocks` relations (what this unblocks)
- Any labels or priority

### 2.2 Read project context (if not already loaded)

If Phase 1 ran (no issue ID provided), `docs/PROJECT_SPEC.md` is already in context — skip this step.

If Phase 1 was skipped (issue ID provided as argument):

```
Read docs/PROJECT_SPEC.md
```

Note the current phase and any relevant architectural decisions.

### 2.3 Fetch issue comments

```
mcp__linear-server__list_comments({ issueId: "[issue-uuid]" })
```

Review any prior discussion, decisions, or context from team members.

### 2.4 Explore codebase

Using Read, Grep, and Glob tools:

- Identify key files mentioned in the issue
- Find existing patterns to follow
- Note related components or APIs

Focus on files directly relevant to the issue (2-5 files max).

### 2.5 Write plan

Write the plan directly in your response using this structure:

```markdown
# Plan: HON-XX - [Issue Title]

**Issue:** HON-XX
**Branch:** `[gitBranchName from Linear]`

## Context

[2-3 sentence summary of the issue and relevant background]

## Design Decisions

| Decision       | Choice        | Rationale |
| -------------- | ------------- | --------- |
| [Key decision] | [Your choice] | [Why]     |

## Files to Create

- `src/path/to/new/file.tsx` - [Purpose]

## Files to Modify

- `src/path/to/existing/file.ts` - [What changes]

## Implementation Steps

1. [Specific step with details]
2. [Specific step with details]
3. [Specific step with details]

## Tests

- `src/path/to/file.test.ts` - [What to test]

## Verification

- [ ] [How to test the implementation]
- [ ] [What to verify works correctly]
- [ ] [Edge cases to check]
```

### 2.6 Post plan to Linear

Post the plan directly to Linear (no approval needed in auto mode):

```
mcp__linear-server__create_comment({
  issueId: "[issue-uuid]",
  body: "[The complete plan from step 2.5]"
})
```

```
[auto-implement] ✓ Plan posted to Linear
[auto-implement] Phase 2/7 complete → Proceeding to Phase 3
```

---

## Phase 3: Implement

```
[auto-implement] Phase 3/7: Implementing HON-XX
```

### 3.1 Update issue status

```
mcp__linear-server__update_issue({
  id: "HON-XX",
  state: "In Progress",
  assignee: "me"
})
```

### 3.2 Create or switch to branch

**Worktree mode:**

The worktree branch is already set. Just verify:

```bash
git branch --show-current
```

**Regular repo mode:**

Check if branch already exists:

```bash
git branch --list "[gitBranchName]"
```

If branch exists:

```bash
git checkout [gitBranchName]
```

If branch doesn't exist:

```bash
git checkout -b [gitBranchName]
```

### 3.3 Implement following the plan

The plan from Phase 2.5 is already in context — do not re-fetch it from Linear.

For each implementation step in the plan:

1. Read relevant files using Read tool
2. Make changes using Edit or Write tools
3. Write tests for new functionality (unit tests colocated with source files)
4. Follow patterns from CLAUDE.md

```
[auto-implement] ✓ Implementation complete
[auto-implement] Phase 3/7 complete → Proceeding to Phase 4
```

---

## Phase 4: Review and Fix

```
[auto-implement] Phase 4/7: Reviewing changes
```

### 4.1 Collect all changes

```bash
# Committed changes (vs main)
git diff --name-only origin/main...HEAD

# Staged but uncommitted
git diff --cached --name-only

# Unstaged changes
git diff --name-only

# Untracked files
git ls-files --others --exclude-standard
```

Deduplicate the file list.

### 4.2 Get the diffs

```bash
# All changes combined
git diff origin/main...HEAD
git diff --cached
git diff
```

For untracked files, use Read tool.

### 4.3 Review the changes for

CLAUDE.md is already loaded as project instructions — do not re-read it. Read `docs/TYPOGRAPHY.md` only if the changes involve typography components.

- **Bugs**: Logic errors, edge cases, null/undefined handling
- **Security**: Injection risks, auth bypasses, sensitive data exposure
- **Patterns**: Adherence to CLAUDE.md conventions (sentence case, typography components, etc.)
- **TypeScript**: Type safety, any types, missing types
- **Tests**: Missing test coverage for new functionality
- **Performance**: N+1 queries, unnecessary re-renders, large bundle imports

### 4.4 Triage issues

Using **effort-first** thinking:

- Quick fix (< 5 min) → **address now**
- Moderate fix (15-30 min, in scope) → **address now**
- Significant work (hours) → defer only if truly out of scope

Categories:

- **Address Now**: Fix before PR merge
- **Defer**: Only for significant out-of-scope work
- **Skip**: Disagree or not actionable

### 4.5 Fix loop

If there are issues to address:

```
max_attempts = 3
attempt = 0

while issues remain and attempt < max_attempts:
    attempt += 1
    [auto-implement] Fix attempt {attempt}/3

    For each issue in "Address Now":
        - Read the file at the specified location
        - Analyze the issue and code context
        - Apply the fix using Edit tool

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

### 4.6 Proceed

```
[auto-implement] ✓ All checks passing
[auto-implement] Phase 4/7 complete → Proceeding to Phase 5
```

---

## Phase 5: Commit and Create PR

```
[auto-implement] Phase 5/7: Creating commit and PR
```

### 5.1 Stage changes

List changed/untracked files and stage them by name. Do NOT use `git add -A` or `git add .`.

```bash
git status --porcelain
```

Stage specific files (example):

```bash
git add src/components/MyComponent.tsx src/components/MyComponent.test.tsx
```

Review what will be committed. Warn and exclude if secrets detected (`.env`, credentials, etc.).

### 5.2 Create commit

Follow commit conventions from CLAUDE.md. Use HEREDOC format:

```bash
git commit -m "$(cat <<'EOF'
type(scope): Subject line

Body explaining what and why.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

### 5.3 Analyze for PR description

```bash
# All commits on this branch
git log origin/main..HEAD --format="%s%n%b"

# Full diff
git diff origin/main...HEAD --stat
```

Fetch issue description from Linear for the "Context" section.

### 5.4 Push and create PR

```bash
# Push with upstream tracking
git push -u origin $(git branch --show-current)

# Create PR using HEREDOC
gh pr create --title "type(scope): Subject" --body "$(cat <<'EOF'
## Context

[Why these changes were made. From Linear issue description. Closes HON-XX]

## Summary

- [Bullet points describing changes]

## Test plan

- [ ] [How to verify changes]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Extract PR URL from output.

```
[auto-implement] ✓ PR created: [URL]
[auto-implement] Phase 5/7 complete → Proceeding to Phase 6
```

---

## Phase 6: Address Reviews

```
[auto-implement] Phase 6/7: Addressing reviews
```

### 6.1 Wait for CI

```bash
gh pr checks --watch --interval 10  # Use 600s Bash timeout
```

If timeout expires, report and stop.

If CI fails, attempt to fix (max 2 attempts):

```
ci_attempts = 0
max_ci_attempts = 2

while CI failing and ci_attempts < max_ci_attempts:
    ci_attempts += 1
    [auto-implement] CI fix attempt {ci_attempts}/2

    - Analyze CI failure output
    - Apply fixes using Edit tool
    - Stage specific changed files by name and commit:
      git add [changed files] && git commit -m "fix: Address CI failures"
    - Push: git push
    - Wait: gh pr checks --watch --interval 10  # Use 600s Bash timeout

If still failing after 2 attempts:
    [auto-implement] ✗ Error: CI checks failing after fix attempts
    Stop here with failure details
```

### 6.2 Get PR info

```bash
gh pr view --json number,title,headRefName,url
```

### 6.3 Wait for Greptile review

**IMPORTANT:** Greptile does NOT show up as a GitHub check. It posts comments asynchronously after CI completes. You MUST wait for Greptile before proceeding to merge.

Poll for Greptile comment with timeout:

```
max_wait_seconds = 600  # 10 minutes
poll_interval = 15
elapsed = 0

[auto-implement] Waiting for Greptile review...

while elapsed < max_wait_seconds:
    # Check PR-level comments for Greptile
    gh api /repos/:owner/:repo/issues/{number}/comments

    # Check inline review comments for Greptile
    gh api /repos/:owner/:repo/pulls/{number}/comments

    # Check review summaries for Greptile
    gh api /repos/:owner/:repo/pulls/{number}/reviews

    # Look for comments from "greptile-apps[bot]"
    If Greptile comment found:
        [auto-implement] ✓ Greptile review received
        break

    sleep {poll_interval}
    elapsed += poll_interval
    [auto-implement] Waiting for Greptile... ({elapsed}s/{max_wait_seconds}s)

If no Greptile comment after timeout:
    [auto-implement] ⚠ Greptile review not received after {max_wait_seconds}s
    [auto-implement] Proceeding with available comments (manual review recommended)
```

### 6.4 Parse and triage comments

**Filter out noise:**

- Bot messages about usage limits
- Empty comments
- Automated status messages

**Parse Greptile severity markers:**

| Greptile Pattern          | Maps To       |
| ------------------------- | ------------- |
| "Critical Issues" heading | 🔴 Critical   |
| "critical" in body        | 🔴 Critical   |
| "Improvements Needed"     | 🟡 Suggestion |
| "suggestion" / "consider" | 🟡 Suggestion |
| Other actionable feedback | 🟢 Nitpick    |

**Triage using effort-first thinking:**

- Quick fix → address now
- Moderate fix → address now
- Significant work → defer if out of scope

### 6.5 Address review comments

For each item in "Address Now":

- Extract file path and line number
- Read the file at that location
- Apply the suggested fix using Edit tool

### 6.6 Commit and push fixes

If fixes were made:

```bash
git status --porcelain
```

If changes exist, stage specific changed files by name:

```bash
git add [changed files]
git commit -m "$(cat <<'EOF'
fix: Address review feedback

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
git push
```

Wait for CI again:

```bash
gh pr checks --watch --interval 10  # Use 600s Bash timeout
```

```
[auto-implement] ✓ Reviews addressed
[auto-implement] Phase 6/7 complete → Proceeding to Phase 7
```

---

## Phase 7: Merge

```
[auto-implement] Phase 7/7: Merging PR
```

### 7.1 Pre-flight checks

```bash
# Check for uncommitted changes
git status --porcelain

# Get PR status
gh pr view --json number,state,mergeable,mergeStateStatus,url
```

Validation:

| Check     | Fail Condition | Error Message                          |
| --------- | -------------- | -------------------------------------- |
| PR state  | CLOSED         | "PR is closed. Cannot merge."          |
| Mergeable | Not mergeable  | "PR cannot be merged. Check conflicts" |

### 7.2 Wait for CI

```bash
gh pr checks --watch --fail-fast --interval 10  # Use 600s Bash timeout
```

If timeout expires or any check fails, report and stop.

### 7.3 Merge the PR

**Detect environment first** (reuse from Phase 0):

```bash
git rev-parse --git-common-dir
git rev-parse --git-dir
```

**Regular repo mode:**

```bash
gh pr merge --squash --delete-branch
```

**Worktree mode:**

`gh pr merge --delete-branch` fails in worktrees because `gh` tries to checkout main internally, which conflicts with the parent worktree. Use without `--delete-branch`:

```bash
gh pr merge --squash
```

The remote branch is still deleted by GitHub. The local worktree branch is preserved (user cleans up worktree manually).

### 7.4 Post summary to Linear

After merging but before local cleanup, post a work summary to the Linear issue.

The issue UUID is already in context from Phase 2.1. The PR number and URL are available from Phase 5.4 / Phase 6.2.

**Gather PR data:**

```bash
# PR details and files (works after merge — does not depend on branch)
gh pr view --json number,title,url,commits,files

# Review comments: inline comments + review-level summaries
gh api /repos/{owner}/{repo}/pulls/{number}/comments
gh api /repos/{owner}/{repo}/pulls/{number}/reviews
```

Extract owner/repo from `gh repo view --json nameWithOwner --jq .nameWithOwner`.

**Post comment to Linear:**

```
mcp__linear-server__create_comment({
  issueId: "[issue-uuid]",
  body: "[summary comment]"
})
```

**Comment template:**

```markdown
## Merged: PR #XX — type(scope): Title

**PR:** [#XX](url)

### Changes
- X files changed
- [file list with +/- stats from gh pr view --json files]

### Commits
- [commit messages from gh pr view --json commits]

### Review feedback addressed
- [summary of review comments that were addressed, or "No review feedback" if none]
```

**After posting**, print the summary to the terminal as well so the user can see it inline.

**Rules:**
- If Linear API calls fail, still print the summary to terminal — don't block the merge flow
- Keep the summary concise — list files and stats, don't dump full diffs

### 7.5 Local cleanup

**Regular repo mode:**

```bash
git checkout main
git pull origin main
git branch -d [branch-name] || git branch -D [branch-name]
```

**Worktree mode:**

Cannot fetch into main (already checked out in parent worktree). Skip local cleanup - the worktree will be removed by the user.

### 7.6 Report completion

**Regular repo mode:**

```
[auto-implement] ✓ PR merged successfully
- Remote branch deleted
- Local branch deleted
- Now on main with latest changes

[auto-implement] ✓ Autonomous implementation cycle complete
```

**Worktree mode:**

```
[auto-implement] ✓ PR merged successfully
- Remote branch deleted
- Worktree branch preserved

To clean up this worktree:
  git worktree remove <worktree-path>

[auto-implement] ✓ Autonomous implementation cycle complete
```

---

## Error Summary

| Phase | Error                           | Action                 |
| ----- | ------------------------------- | ---------------------- |
| 0     | Not on main (regular repo only) | Stop with instructions |
| 0     | Uncommitted changes             | Stop with instructions |
| 1     | No unblocked issues             | Stop (normal exit)     |
| 4     | Fix attempts exhausted (3)      | Stop, show failures    |
| 5     | Commit/PR fails                 | Stop, show error       |
| 6     | CI fails after fixes (2)        | Stop, show failures    |
| 6     | Review parse fails              | Stop, show error       |
| 7     | Merge fails                     | Stop, show error       |
