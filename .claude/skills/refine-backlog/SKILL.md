---
name: refine-backlog
description: Refine draft issues into actionable backlog items with proper relationships
context: inherit
---

# Backlog Refinement Skill

You are assisting CPO+CTO in fleshing out draft ideas, features, and issues into actionable, implementation-ready backlog items.

## Phase 1: Context Gathering

### Step 1: Fetch project context

```typescript
mcp__linear - server__get_project({ query: '5a19627a-803f-4052-83c4-b44810d17af7' })
```

Review the project description for:

- Current phase and active milestone
- Product vision and decisions
- Technical architecture context

### Step 2: Find draft issues

```typescript
mcp__linear -
  server__list_issues({
    project: '5a19627a-803f-4052-83c4-b44810d17af7',
    query: '[DRAFT]',
    includeArchived: false,
    limit: 50,
  })
```

### Step 3: Present summary

Show user:

- Number of draft issues found
- Brief list with titles and current state
- Ask which to refine first (or offer to go through all)

## Phase 2: Refinement Loop

For each draft issue:

### Step 4: Fetch full issue details

```typescript
mcp__linear - server__get_issue({ id: 'HON-XX', includeRelations: true })
```

### Step 5: Present current state

Display:

- Title (with [DRAFT] marker)
- Description (if any)
- Current relationships (blockedBy, blocks, relatedTo)
- Milestone/cycle assignment

### Step 6: Collaborative refinement

Discuss with user:

1. **Scope clarity**: Is the scope well-defined? Too broad? Too narrow?
2. **Acceptance criteria**: What does "done" look like?
3. **Technical approach**: Any key implementation decisions?
4. **Dependencies**: What must happen first? What does this unblock?
5. **Split/merge**: Should this be multiple issues? Is it a duplicate?

### Step 7: Update or create

**For refinements:**

```typescript
mcp__linear -
  server__update_issue({
    id: 'issue-uuid',
    title: 'Refined title without [DRAFT]',
    description: 'Full description with acceptance criteria',
    // Add relationships as needed:
    // blockedBy: ['HON-XX'],
    // blocks: ['HON-YY'],
    // relatedTo: ['HON-ZZ']
  })
```

**For splits (create new issues):**

```typescript
mcp__linear -
  server__create_issue({
    title: 'New issue title',
    team: 'Honkadori',
    project: '5a19627a-803f-4052-83c4-b44810d17af7',
    description: 'Description',
    blockedBy: ['parent-issue-id'], // if applicable
  })
```

**For duplicates:**

```typescript
mcp__linear -
  server__update_issue({
    id: 'duplicate-issue-id',
    duplicateOf: 'original-issue-id',
    state: 'Duplicate',
  })
```

### Step 8: Confirm and proceed

After updating Linear, confirm changes and ask user which issue to tackle next.

## Phase 3: Creating New Drafts

If user wants to create new issues during the session:

### Step 9: Draft new issue

Discuss with user:

- What's the feature/fix/task?
- Why is it needed?
- Initial scope thoughts

### Step 10: Create in Linear

```typescript
mcp__linear -
  server__create_issue({
    title: '[DRAFT] Initial idea title', // Keep [DRAFT] if not fully refined
    team: 'Honkadori',
    project: '5a19627a-803f-4052-83c4-b44810d17af7',
    description: 'Initial description - to be refined',
  })
```

Or create as fully refined if discussion was thorough enough.

## Phase 4: Session Summary

### Step 11: Summarize session

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
- [ ] Correct milestone/cycle assignment
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
