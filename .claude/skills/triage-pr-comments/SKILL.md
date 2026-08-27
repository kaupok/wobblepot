---
name: triage-pr-comments
description: Fetch PR review comments and triage into actionable categories
context: inherit
---

# Triage PR comments

Fetches GitHub PR review comments and triages them into actionable categories.

## Usage

```
/triage-pr-comments
```

Run this command on a feature branch with an existing PR to see external review feedback.

## Workflow

### Step 1: Get PR Info

```bash
gh pr view --json number,title,headRefName,url,headRepository 2>/dev/null
```

If no PR exists, inform user: "No PR found for this branch. Create one with `/create-pr` first."

### Step 2: Get Claude Review

Check if a Claude review already exists:

```bash
gh api /repos/:owner/:repo/issues/{number}/comments \
  --jq '[.[] | select(.body | startswith("<!-- claude-review -->"))] | length'
```

If review exists (count > 0):

```
[triage-pr-comments] ✓ Claude review found
```

Proceed to Step 3.

If no review exists, trigger one:

```
[triage-pr-comments] No Claude review found. Triggering review...
```

```bash
./scripts/pr-review.sh ${PR_NUMBER}
```

After the script returns:

```
[triage-pr-comments] ✓ Claude review posted
```

Proceed to Step 3.

### Step 3: Fetch Comments

Extract the PR number from Step 1, then fetch both types of comments in parallel.

**Note:** Use the repo name from the current directory context. The `gh api` command can use `:owner/:repo` shorthand which auto-fills from the current git remote, or explicitly use the values from `headRepository.owner.login` and `headRepository.name`.

```bash
# PR-level comments (general discussion)
gh api /repos/:owner/:repo/issues/{number}/comments \
  --jq '.[] | {id, author: .user.login, body, created_at}'

# Review comments (inline code comments)
gh api /repos/:owner/:repo/pulls/{number}/comments \
  --jq '.[] | {id, author: .user.login, path, line, original_line, body, diff_hunk}'

# Review summaries (top-level text submitted with Approve/Request Changes)
gh api /repos/:owner/:repo/pulls/{number}/reviews \
  --jq '.[] | {id, author: .user.login, state, body}'
```

Replace `{number}` with the PR number from Step 1.

All three endpoints expose the author as `.user.login` — keep it in the projection. Step 4's bot filter depends on it.

### Step 4: Filter and Parse

**Filter out noise** — drop only these, keep everything else:

- Empty comments (blank `body` — e.g. a bare Approve submitted with no text)
- Bot status comments: `author` ends in `[bot]` (e.g. `vercel[bot]`, `github-actions[bot]`, `linear[bot]`). Deployment previews, CI status, and issue-link stubs are never actionable.
- The Claude review's own summary comment (`body` starts with `<!-- claude-review -->`) — but only _after_ it has been parsed below. Its confidence score and "No issues found" verdict feed the severity mapping; the summary itself is not a triage item.

**Keep every human comment**, regardless of format. Do not require the `<!-- claude-review -->` marker or a bold issue title — human reviewers write free-form, and this skill exists to surface all external feedback. Human comments go through the same Step 5 rubric as Claude findings. If a human comment carries no obvious severity signal, default it to 🟡 Suggestion and let effort decide. Note the Claude reviewer posts via `gh` under the user's own account, not a `[bot]` login, so the `[bot]` rule never touches its inline findings.

**Parse Claude review format:**

The Claude reviewer only posts substantive issues (no nitpicks by design). Map to severity:

| Signal                                         | Maps To       |
| ---------------------------------------------- | ------------- |
| Inline review comment (bold title format)      | 🟡 Suggestion |
| Summary says "No issues found"                 | Clean review  |
| Summary confidence 1-2/5 → upgrade all issues  | 🔴 Critical   |
| Summary confidence 3-5/5 → keep default        | 🟡 Suggestion |

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

**Ignore reviewer's triage.** Reviewers often suggest deferring things or mark items as "out of scope." Apply your own effort-based assessment. If it's a quick fix and directly related to this PR's changes, it's in scope - do it now.

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

## Completion

After outputting the review triage, add the completion marker:

```
[triage-pr-comments:complete] Review triage finished - {X} items to address
```

## Notes

- This skill fetches EXTERNAL review feedback — from the Claude PR reviewer via `scripts/pr-review.sh` and from human reviewers alike
- For LOCAL code review before committing, use `/branch-review` instead
- **Bias toward action** - when in doubt, put it in Address Now
- **Defer is last resort** - only for work that genuinely takes hours and is out of scope
