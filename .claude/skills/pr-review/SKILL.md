---
name: pr-review
description: Fetch PR review comments and parse into triage-ready format
context: inherit
---

# PR Review

Fetches GitHub PR review comments and formats them for `/triage-review`.

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

### Step 2: Fetch Comments

Fetch both types of comments in parallel:

```bash
# PR-level comments (general discussion)
gh api /repos/{owner}/{repo}/issues/{number}/comments

# Review comments (inline code comments)
gh api /repos/{owner}/{repo}/pulls/{number}/comments
```

### Step 3: Filter and Parse

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

### Step 4: Format Output

Output format compatible with `/triage-review`:

```markdown
## PR Review Comments

**PR:** #{number} - {title}
**URL:** {url}
**Reviewers:** {list of comment authors}

### Issues

🔴 **Critical** ({count})

1. [{path}#{line}] {summary of issue}
   > {quoted comment excerpt}

🟡 **Suggestions** ({count})

1. [{path}#{line}] {summary of issue}
   > {quoted comment excerpt}

🟢 **Nitpicks** ({count})

1. [{path}#{line}] {summary of issue}
   > {quoted comment excerpt}

### Summary

- Total comments: {count}
- Actionable items: {count}
- Files affected: {list}
```

### Step 5: Handle Edge Cases

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
```

## Notes

- This skill fetches EXTERNAL review feedback (from GitHub reviewers like Greptile)
- For LOCAL code review before committing, use `/code-review` instead
- Output is designed to feed directly into `/triage-review`
