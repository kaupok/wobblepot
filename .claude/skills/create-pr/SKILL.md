---
name: create-pr
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

### 3. Gather context

PR conventions are in CLAUDE.md (already loaded as project instructions). PR title must follow Conventional Commits (becomes the squash-merge commit message).

Run in parallel:

```bash
# All commits on this branch
git log origin/main..HEAD --oneline

# Full diff for analysis
git diff origin/main...HEAD --stat

# Check if branch is pushed
git status -sb
```

### 4. Check for existing PR

```bash
gh pr view --json number,title,url 2>/dev/null
```

If PR already exists, inform user and offer to update the description instead.

### 5. Analyze changes and gather context

Review all commits (not just the latest) to understand the full scope:

```bash
git log origin/main..HEAD --format="%s%n%b"
```

**Gather context for the "why":**

If Linear issue ID is in branch name (e.g., `hon-XX`):

```
mcp__linear-server__get_issue({ id: "HON-XX", includeRelations: true })
```

Extract the issue description - this is the primary source for the Context section.

Also note any key decisions or rationale from:

- Implementation plan (if posted to Linear comments)
- Conversation context (design tradeoffs, important choices made)

### 5b. Note E2E impact

If the diff includes any of the following, the PR description must state the E2E impact explicitly:

- `src/app/**/page.tsx` (route added, removed, or renamed)
- A modal/dialog component under `src/components/**`
- Navigation/CTA copy changes in a heading, button, or link

Determine which applies and record one of:

- **"E2E specs updated: [list]"** — specs you modified in this branch.
- **"No E2E impact"** — only if no `tests/e2e/*.spec.ts` header (`// ROUTES: … · COMPONENTS: …`) matches the changed routes/components.

Check with:

```bash
grep -l "ROUTES.*<route>\|COMPONENTS.*<Component>" tests/e2e/*.spec.ts
```

This goes in the Summary section of the description (step 6). The goal: a reviewer reading the PR body sees at a glance whether E2E drift was considered, and a future auditor sees whether this PR was the one that broke a given spec. See HON-519 for why this gate exists.

### 6. Draft PR title and description

**Title:** Follow Conventional Commits format (this becomes the squash-merge commit message).

**Description:**

```markdown
## Context

[2-3 sentences explaining why. Primary source: Linear issue description. Supplement with design decisions or rationale if relevant.]

## Summary

- [1-3 bullet points describing the changes]
- **E2E impact:** [From step 5b — either `E2E specs updated: tests/e2e/foo.spec.ts, tests/e2e/bar.spec.ts` or `No E2E impact`. Omit the line entirely only if the diff is pure-backend with no UI / route / modal surface.]

## Test plan

- [ ] [How to verify the changes work]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

If Linear issue is linked, include `Closes HON-XX` at the end of the Context section.

### 7. Push and create PR

```bash
# Push with upstream tracking
git push -u origin $(git branch --show-current)

# Create PR using HEREDOC for body
gh pr create --title "type(scope): Subject" --body "$(cat <<'EOF'
## Context
[Why these changes were made. Closes HON-XX if applicable.]

## Summary
- ...
- E2E impact: [specs updated | No E2E impact]

## Test plan
- [ ] ...

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### 8. Report result and signal completion

Return the PR URL, then output the completion marker:

```
[create-pr:complete] PR created: <URL>
```

Do NOT output follow-up suggestions or next steps - just the URL and marker.

### 9. Trigger Claude review

After outputting the PR completion marker, invoke the `/review-pr` skill to run the Claude reviewer.

## Important

- Follow conventions from docs, don't invent new rules
- PR title is critical - it becomes the final commit message after squash-merge
- Analyze ALL commits on the branch, not just the latest
- If PR already exists, offer to update description instead of creating new one
