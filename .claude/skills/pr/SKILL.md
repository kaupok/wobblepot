---
name: pr
description: Create a pull request following project conventions. Analyzes all commits, generates description, and creates PR.
context: inherit
---

# Pull Request

Create a pull request following project conventions.

## Workflow

### 1. Verify branch state

```bash
git branch --show-current
```

If on `main`, stop and inform the user.

### 2. Check for changes

```bash
git log origin/main..HEAD --oneline
```

If no commits ahead of main, inform the user there's nothing to create a PR for.

### 3. Review conventions

Read `docs/GIT_WORKFLOW.md` for:

- PR title format (must follow Conventional Commits for squash-merge)
- PR body format (Context, Summary, Test plan, attribution)
- Context section guidance (why > what)

Read `CLAUDE.md` section "Commit Message Conventions" for type prefixes.

### 4. Gather context

Run in parallel:

```bash
# All commits on this branch
git log origin/main..HEAD --oneline

# Full diff for analysis
git diff origin/main...HEAD --stat

# Check if branch is pushed
git status -sb
```

### 5. Check for existing PR

```bash
gh pr view --json number,title,url 2>/dev/null
```

If PR already exists, inform user and offer to update the description instead.

### 6. Analyze changes and gather context

Review all commits (not just the latest) to understand the full scope:

```bash
git log origin/main..HEAD --format="%s%n%b"
```

**Gather context for the "why":**

If Linear issue ID is in branch name (e.g., `hon-XX`):

```
mcp__linear-server__get_issue({ id: "HON-XX" })
```

Extract the issue description - this is the primary source for the Context section.

Also note any key decisions or rationale from:

- Implementation plan (if posted to Linear comments)
- Conversation context (design tradeoffs, important choices made)

### 7. Draft PR title and description

**Title:** Follow Conventional Commits format (this becomes the squash-merge commit message).

**Description:** Follow the format from GIT_WORKFLOW.md:

```markdown
## Context

[2-3 sentences explaining why. Primary source: Linear issue description. Supplement with design decisions or rationale if relevant.]

## Summary

- [1-3 bullet points describing the changes]

## Test plan

- [ ] [How to verify the changes work]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

If Linear issue is linked, include `Closes HON-XX` at the end of the Context section.

### 8. Push and create PR

```bash
# Push with upstream tracking
git push -u origin $(git branch --show-current)

# Create PR using HEREDOC for body
gh pr create --title "type(scope): Subject" --body "$(cat <<'EOF'
## Context
[Why these changes were made. Closes HON-XX if applicable.]

## Summary
- ...

## Test plan
- [ ] ...

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### 9. Report result and signal completion

Return the PR URL, then output the completion marker:

```
[pr:complete] PR created: <URL>
```

Do NOT output follow-up suggestions or next steps - just the URL and marker.

## Important

- Follow conventions from docs, don't invent new rules
- PR title is critical - it becomes the final commit message after squash-merge
- Analyze ALL commits on the branch, not just the latest
- If PR already exists, offer to update description instead of creating new one
