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
- **Follow-ups:** [IDs of the issues filed for steps this PR does not ship (the plan's `## Follow-ups`, and any `/implement-issue` filed): `HON-NNN (Queued, blocked by HON-XX)`. Omit the line if there are none.]
- **Coupled callsites:** [If the diff changes a primitive's geometry default, a `@theme` token, or a shared layout wrapper — either `Mirrors updated: src/app/foo/loading.tsx, …` or `none — no callsite hardcodes the changed <property>`. Omit the line entirely if none of those changed. Without it the scan's result lives only in the Linear plan and a GitHub reviewer cannot see that it ran (CLAUDE.md shared-primitive geometry rule).]

## Verified

- [What was run or asserted, and the result. Name the command, test, story or spec: "`pnpm test` — 4745 passed", "`CookieBanner.stories.tsx` › PhoneWithTabBar asserts the 80px offset", "Tier 1 E2E green on the PR".]

## Not verified

- [What could not be checked from here, and why: needs credentials, needs a real device, needs a paid API call, only observable after merge. Write `Nothing` if there is nothing.]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

If Linear issue is linked, include `Closes HON-XX` at the end of the Context section.

**No checkboxes anywhere in a PR body.** Nobody ticks them: in the unattended cycle a `- [ ]` is a step addressed to a human who will not do it, and the PR merges with it open (HON-860). Write the two lists by these rules:

1. A line goes under "Verified" only if you ran it and saw the result. Intent is not verification.
2. Do not write a step for a human to perform. If a fact can be asserted, assert it in a test or a story play function and cite that under "Verified". If it cannot be checked at all, it goes under "Not verified" with the reason.
3. "Not verified" is not a to-do list and creates no follow-up by itself. It is a statement of remaining risk.
4. A step that must happen after merge (restart a process, run a workflow, re-record a golden) is not a "Verified" or "Not verified" line. The merge step performs it, or it is an issue, filed before this PR merges, with its ID on the Summary's **Follow-ups** line (CLAUDE.md → "A follow-up is an issue"). If it has no issue yet, file it now with the `save_issue` call in `/plan-issue` step 10 (`addLabels: ["Follow-up"]`, first description line `Follow-up to HON-XX, filed by /create-pr.`), then list the ID.

### 7. Push and create PR

```bash
# Push with upstream tracking
git push -u origin $(git branch --show-current)

# Create PR using HEREDOC; the body is the full description drafted in step 6
gh pr create --title "type(scope): Subject" --body "$(cat <<'EOF'
[The description drafted in step 6]
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
