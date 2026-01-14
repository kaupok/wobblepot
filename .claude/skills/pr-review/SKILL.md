---
name: pr-review
description: Fetch PR review comments and triage into actionable categories
context: inherit
---

# PR Review

Fetches GitHub PR review comments and triages them into actionable categories.

## Usage

```
/pr-review
```

Run this command on a feature branch with an existing PR to see external review feedback.

## Workflow

### Step 1: Get PR Info

```bash
gh pr view --json number,title,headRefName,url,headRepository 2>/dev/null
```

If no PR exists, inform user: "No PR found for this branch. Create one with `/pr` first."

### Step 2: Wait for Greptile Review

Check if Greptile review exists. Greptile posts as an **issue comment**, not a PR review:

```bash
# Check for Greptile comment
gh api /repos/:owner/:repo/issues/{number}/comments \
  --jq '.[] | select(.user.login == "greptile-apps[bot]") | .user.login'
```

Replace `{number}` with the PR number from Step 1.

**If Greptile comment exists:** Proceed to Step 3.

**If no Greptile comment:**

1. Inform user: "Waiting for Greptile review..."
2. Poll every 15 seconds for up to 10 minutes (40 attempts)
3. After each poll, report progress: "Still waiting... (X/40)"
4. If found: "Greptile review found." → Proceed to Step 3

**If timeout reached (10 minutes) without Greptile comment:**

Use AskUserQuestion to prompt the user:

- Question: "Greptile review not found after 10 minutes. What would you like to do?"
- Options: "Continue without Greptile" | "Keep waiting"
- If "Keep waiting": Repeat the polling loop
- If "Continue without Greptile": Proceed to Step 3

### Step 3: Fetch Comments

Extract the PR number from Step 1, then fetch both types of comments in parallel.

**Note:** Use the repo name from the current directory context. The `gh api` command can use `:owner/:repo` shorthand which auto-fills from the current git remote, or explicitly use the values from `headRepository.owner.login` and `headRepository.name`.

```bash
# PR-level comments (general discussion)
gh api /repos/:owner/:repo/issues/{number}/comments

# Review comments (inline code comments)
gh api /repos/:owner/:repo/pulls/{number}/comments
```

Replace `{number}` with the PR number from Step 1.

### Step 4: Filter and Parse

**Filter out noise:**

- Bot messages about usage limits (e.g., "You have reached your Codex usage limits")
- Empty comments
- Automated status messages

**Parse Greptile severity markers:**

Greptile uses specific patterns in its reviews. Map these to severity levels:

| Greptile Pattern              | Maps To       |
| ----------------------------- | ------------- |
| "Critical Issues" heading     | 🔴 Critical   |
| "critical" in comment body    | 🔴 Critical   |
| "Improvements Needed" heading | 🟡 Suggestion |
| "suggestion" / "consider"     | 🟡 Suggestion |
| Other actionable feedback     | 🟢 Nitpick    |

**Extract key fields from review comments:**

- `path`: File path
- `line` or `original_line`: Line number
- `body`: Comment text
- `diff_hunk`: Code context

### Step 5: Triage Issues

After parsing all comments, triage each one using **effort-first** thinking:

**Effort** (primary factor):

- Quick fix (few lines, < 5 min) → **address now**, regardless of severity
- Moderate fix (15-30 min, in scope) → **address now**
- Significant work (new feature, major refactor) → defer only if truly out of scope

**Severity** (secondary factor):

- 🔴 Critical → always address now, regardless of effort
- 🟡 Suggestion → address if quick or moderate effort
- 🟢 Nitpick → address if quick fix, otherwise skip

**Bias toward action.** Deferred items rarely get done. If something can be fixed in a few minutes, just fix it.

**Ignore reviewer's triage.** Reviewers (including Greptile) often suggest deferring things or mark items as "out of scope." Apply your own effort-based assessment. If it's a quick fix and directly related to this PR's changes, it's in scope - do it now.

Place each item in one of three buckets:

- **Address Now**: Fix before PR merge. Includes all quick fixes and anything critical.
- **Defer**: Only for significant work (hours, not minutes) that's genuinely out of scope. Must justify why.
- **Skip**: Disagree with the suggestion or it's not actionable. Explain why.

### Step 6: Format Output

```markdown
## PR Review: #{number} - {title}

**URL:** {url}
**Reviewers:** {list of comment authors}
**Comments:** {total} total, {actionable} actionable

### Triage

#### Address Now

1. [🔴/🟡/🟢] [Issue description] - `{path}:{line}` - [effort: quick/moderate]
   > {quoted comment excerpt}
2. ...

#### Defer

1. [Issue description] - `{path}:{line}` - [Why out of scope]
2. ...
   (If empty: "None")

#### Skip

1. [Issue description] - [Why disagreed or not actionable]
2. ...
   (If empty: "None")

### Next Steps

1. Fix [specific item] in `file:line`
2. Fix [specific item] in `file:line`
3. Run `/commit --push` when done
```

### Step 7: Handle Edge Cases

**No comments:**

```
No review comments found on PR #{number}.

The PR is ready for the next step:
- If approved: Run `/merge`
- If waiting for review: Check back later
```

**Only bot noise filtered out:**

```
No actionable review comments found on PR #{number}.
(Filtered {count} automated/noise comments)

Ready to `/merge` if approved.
```

## Notes

- This skill fetches EXTERNAL review feedback (from GitHub reviewers like Greptile)
- For LOCAL code review before committing, use `/code-review` instead
- **Bias toward action** - when in doubt, put it in Address Now
- **Defer is last resort** - only for work that genuinely takes hours and is out of scope
