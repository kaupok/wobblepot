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

The Claude review it reads is the comment marked `<!-- claude-review -->`, which `/create-pr` posts through `/review-pr`. A PR opened with a raw `gh pr create` has none, so step 2 runs the reviewer first. `/review-pr` → "When to run it" has the whole chain.

## Workflow

### Step 1: Get PR Info

```bash
gh pr view --json number,title,headRefName,url,headRepository 2>/dev/null

# The PR number, for the review script and the fetches below
PR_NUMBER=$(gh pr view --json number --jq .number)
```

If no PR exists, inform user: "No PR found for this branch. Create one with `/create-pr` first."

### Step 2: Get Claude Review

Check if a Claude review already exists:

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)  # fresh shell — re-derive, never reuse
./scripts/pr-comments.sh "$PR_NUMBER" issue \
  | jq '[.[] | select(.body | startswith("<!-- claude-review -->"))] | length'
```

`scripts/pr-comments.sh` fetches every page and prints one JSON array. When the fetch fails it prints nothing and says why on stderr: report it, do not read it as no review.

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
PR_NUMBER=$(gh pr view --json number --jq .number)  # fresh shell — re-derive, never reuse
./scripts/pr-review.sh ${PR_NUMBER}
```

This spawns `claude -p` and takes several minutes. Run it with `timeout: 600000` (or `run_in_background: true` and poll for the `<!-- claude-review -->` comment) — the default 120 s Bash timeout kills it mid-run and leaves a stale `/tmp/claude-review-N.lock`.

After the script returns:

```
[triage-pr-comments] ✓ Claude review posted
```

Proceed to Step 3.

### Step 3: Fetch Comments

Fetch all three kinds of comments in parallel. `scripts/pr-comments.sh` reads the repo from the current git remote.

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)  # fresh shell — re-derive, never reuse

# PR-level comments (general discussion)
./scripts/pr-comments.sh "$PR_NUMBER" issue \
  | jq '.[] | {id, author: .user.login, body, created_at}'

# Review comments (inline code comments)
./scripts/pr-comments.sh "$PR_NUMBER" inline \
  | jq '.[] | {id, author: .user.login, path, line, original_line, body, diff_hunk}'

# Review summaries (top-level text submitted with Approve/Request Changes)
./scripts/pr-comments.sh "$PR_NUMBER" reviews \
  | jq '.[] | {id, author: .user.login, state, body}'
```

All three endpoints expose the author as `.user.login` — keep it in the projection. Step 4's bot filter depends on it.

### Step 4: Filter and Parse

**Filter out noise** — drop only these, keep everything else:

- Empty comments (blank `body` — e.g. a bare Approve submitted with no text)
- Bot status comments: `author` ends in `[bot]` (e.g. `vercel[bot]`, `github-actions[bot]`, `linear[bot]`). Deployment previews, CI status, and issue-link stubs are never actionable.
- The Claude review's own summary comment (`body` starts with `<!-- claude-review -->`) — but only _after_ it has been parsed below. Its confidence score and "No issues found" verdict feed the severity mapping. The summary itself is not a triage item, but each entry in its `**Issues found:**` list that has no matching inline comment is: `scripts/pr-review.sh` puts PR-body findings (checkboxes, uncited "Verified" lines, HON-860), out-of-diff findings and anything past its 5-comment inline cap in the summary alone. Each entry under its `**Spec:**` heading is a triage item as well (HON-1200): the diff checked against the Linear issue's acceptance criteria. A missing criterion is fixed by implementing it, unrequested behaviour by removing it or by adding a row to the Design Decisions table of the `# Plan:` comment on the Linear issue that says why the issue needs it. The reviewer reads the issue and that plan comment, not the PR body, so an explanation in the PR does not clear the entry on the next review. An unproven criterion (HON-1236) is fixed by a test that asserts the result, or by naming in the PR body the existing test, `Driven:` line or `measured:` Proof line that shows it; reasoning alone does not clear it. The status lines `**Spec:** no issue linked` and `**Spec:** issue not readable` are not items.

**Keep every human comment**, regardless of format. Do not require the `<!-- claude-review -->` marker or a bold issue title — human reviewers write free-form, and this skill exists to surface all external feedback. Human comments go through the same Step 5 rubric as Claude findings. If a human comment carries no obvious severity signal, default it to 🟡 Suggestion and let effort decide. Note the Claude reviewer posts via `gh` under the user's own account, not a `[bot]` login, so the `[bot]` rule never touches its inline findings.

**Parse Claude review format:**

The Claude reviewer only posts substantive issues (no nitpicks by design). Map to severity:

| Signal                                         | Maps To       |
| ---------------------------------------------- | ------------- |
| Inline review comment (bold title format)      | 🟡 Suggestion |
| Summary-only `**Issues found:**` entry         | 🟡 Suggestion |
| `**Spec:**` entry: Missing or Implemented but wrong | 🔴 Critical |
| `**Spec:**` entry: Not asked for               | 🟡 Suggestion |
| `**Spec:**` entry: Unproven                    | 🟡 Suggestion |
| Summary says "No issues found" and `**Spec:**` lists no entry | Clean review |
| Summary confidence 1-2/5 → upgrade all issues  | 🔴 Critical   |
| Summary confidence 3-5/5 → keep default        | 🟡 Suggestion |

**Extract key fields from review comments:**

- `path`: File path
- `line` or `original_line`: Line number
- `body`: Comment text
- `diff_hunk`: Code context

### Step 5: Triage Issues

Triage each comment into **Address Now**, **Defer** or **Skip** by `docs/TRIAGE_RUBRIC.md`.

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
