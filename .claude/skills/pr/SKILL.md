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
- PR body format (Summary, Test plan, attribution)
- When to update PR descriptions

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

### 6. Analyze changes

Review all commits (not just the latest) to understand the full scope:
```bash
git log origin/main..HEAD --format="%s%n%b"
```

If Linear issue ID is in branch name (e.g., `hon-XX`), include `Closes HON-XX` in the PR description.

### 7. Draft PR title and description

**Title:** Follow Conventional Commits format (this becomes the squash-merge commit message).

**Description:** Follow the format from GIT_WORKFLOW.md:
```markdown
## Summary
- [1-3 bullet points describing the changes]

## Test plan
- [ ] [How to verify the changes work]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

### 8. Confirm push

Check if branch needs to be pushed:
```bash
git status -sb
```

If not pushed or behind remote, show the user what will be pushed and ask for confirmation before proceeding. If user declines, stop without pushing.

### 9. Push and create PR

After user confirms:
```bash
# Push with upstream tracking
git push -u origin $(git branch --show-current)

# Create PR using HEREDOC for body
gh pr create --title "type(scope): Subject" --body "$(cat <<'EOF'
## Summary
- ...

## Test plan
- [ ] ...

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### 10. Report result

Return the PR URL to the user.

## Important

- Follow conventions from docs, don't invent new rules
- PR title is critical - it becomes the final commit message after squash-merge
- Analyze ALL commits on the branch, not just the latest
- Always ask for confirmation before pushing
- If PR already exists, offer to update description instead of creating new one
