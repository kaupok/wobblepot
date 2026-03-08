---
name: refine-backlog
description: Refine draft or labeled issues into actionable backlog items with proper relationships
argument-hint: '[--tech | --label <name> | --issue HON-XX]'
context: inherit
---

# Backlog Refinement Skill

You are assisting CPO+CTO in fleshing out draft ideas, features, and issues into actionable, implementation-ready backlog items.

## Phase 1: Context Gathering

### Step 1: Parse arguments

Determine the refinement scope:

- **No arguments**: Find `[DRAFT]` issues (default behavior)
- **`--tech`**: Shortcut for `--label Tech` — find issues with the "Tech" label (typically created by `/tech-audit`)
- **`--label <name>`**: Find issues with the specified label
- **`--issue HON-XX`**: Refine a single specific issue

### Step 2: Read project context

```
Read docs/PROJECT_SPEC.md
```

Review for:

- Current phase
- Product vision and decisions
- Technical architecture context

### Step 3: Find issues to refine

**Default (draft) mode:**

```typescript
mcp__linear-server__list_issues({
  query: '[DRAFT]',
  includeArchived: false,
  limit: 50,
})
```

**Label mode (`--tech` or `--label <name>`):**

```typescript
mcp__linear-server__list_issues({
  label: '<label-name>', // e.g. "Tech"
  includeArchived: false,
  limit: 50,
})
```

For Tech issues, focus refinement on: splitting large issues into smaller implementable chunks, verifying acceptance criteria are testable, setting proper priority/ordering, and identifying dependencies between tech debt items.

**Single issue mode (`--issue HON-XX`):**

Skip the list step and go directly to Phase 2 with the specified issue.

### Step 4: Present summary

Show user:

- Number of issues found and the filter used (draft / label / single)
- Brief list with titles, priority, and current state
- Ask which to refine first (or offer to go through all)

## Phase 2: Refinement Loop

For each issue:

### Step 5: Fetch full issue details

```typescript
mcp__linear-server__get_issue({ id: 'HON-XX', includeRelations: true })
```

### Step 6: Present current state

Display:

- Title (with `[DRAFT]` marker if present)
- Labels (Tech, etc.)
- Description (if any)
- Current relationships (blockedBy, blocks, relatedTo)
- Priority if set

### Step 7: Collaborative refinement

**For draft issues**, discuss:

1. **Scope clarity**: Is the scope well-defined? Too broad? Too narrow?
2. **Acceptance criteria**: What does "done" look like?
3. **Technical approach**: Any key implementation decisions?
4. **Dependencies**: What must happen first? What does this unblock?
5. **Split/merge**: Should this be multiple issues? Is it a duplicate?

**For Tech/labeled issues** (e.g., from `/tech-audit`), also discuss:

1. **Scope sizing**: Is this implementable in a single PR? If not, split it.
2. **Acceptance criteria**: Are they specific and testable? (e.g., "coverage above 70%" not "improve coverage")
3. **Priority validation**: Does the assigned priority still make sense? Should it be higher/lower?
4. **Ordering**: Should some tech issues be batched together? (e.g., deps + Next.js update in one PR)
5. **Dependencies**: Does this block or depend on other tech issues? (e.g., Prisma update before type fix)
6. **Labels**: Should additional labels be added? Should Tech issues also have a type label (e.g., "Bug", "Improvement")?

### Step 8: Update or create

**For refinements:**

```typescript
mcp__linear-server__update_issue({
  id: 'issue-uuid',
  title: 'Refined title without [DRAFT]', // Remove [DRAFT] if present; keep as-is for labeled issues
  description: 'Full description with acceptance criteria',
  // Add relationships as needed:
  // blockedBy: ['HON-XX'],
  // blocks: ['HON-YY'],
  // relatedTo: ['HON-ZZ']
})
```

**For splits (create new issues):**

```typescript
mcp__linear-server__save_issue({
  title: 'New issue title',
  team: 'Honkadori',
  description: 'Description',
  blockedBy: ['parent-issue-id'], // if applicable
})
```

**For duplicates:**

```typescript
mcp__linear-server__update_issue({
  id: 'duplicate-issue-id',
  duplicateOf: 'original-issue-id',
  state: 'Duplicate',
})
```

### Step 9: Confirm and proceed

After updating Linear, confirm changes and ask user which issue to tackle next.

## Phase 3: Creating New Drafts

If user wants to create new issues during the session:

### Step 10: Draft new issue

Discuss with user:

- What's the feature/fix/task?
- Why is it needed?
- Initial scope thoughts

### Step 11: Create in Linear

```typescript
mcp__linear-server__save_issue({
  title: '[DRAFT] Initial idea title', // Keep [DRAFT] if not fully refined
  team: 'Honkadori',
  description: 'Initial description - to be refined',
})
```

Or create as fully refined if discussion was thorough enough.

## Phase 4: Session Summary

### Step 12: Summarize session

At end of session, provide:

- **Refined**: Issues that were fleshed out and updated
- **Created**: New issues added during session
- **Archived/Duplicated**: Issues marked as duplicates or canceled
- **Remaining**: Draft issues not yet refined
- **Loose ends**: Questions or decisions to revisit

## Issue Quality Checklist

A well-refined issue should have:

- [ ] Clear, concise title (sentence case, no [DRAFT])
- [ ] Description explaining the "what" and "why"
- [ ] Acceptance criteria (what does done look like?)
- [ ] Appropriate relationships (blockedBy, blocks, relatedTo)
- [ ] Priority set if important

## Relationship Guidelines

- **blockedBy**: This issue cannot start until X is done
- **blocks**: X cannot start until this issue is done
- **relatedTo**: These issues are related but independent
- **duplicateOf**: This issue is a duplicate of X (mark as Duplicate state)
- **parentId**: This is a sub-issue of a larger epic

## Notes

- Work through issues one at a time with user approval
- Don't update Linear until user confirms the refinement
- Keep descriptions concise but complete
- Use sentence case for titles (per project conventions)
- Consider implementation order when setting dependencies
