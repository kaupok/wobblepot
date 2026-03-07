---
name: ideate
description: Flesh out a rough idea into well-structured Linear issues through interactive discussion.
argument-hint: '<idea in a few words>'
context: inherit
---

# Ideate

Take a rough idea and shape it into actionable Linear issues through interactive discussion.

## Pre-flight

### Chrome availability

If Chrome browser tools (`mcp__claude-in-chrome__*`) are available in this session, you can browse the live app during ideation for visual context. Use this — it makes discussions much more grounded.

If Chrome is not available, proceed without it. Optionally mention that `claude --chrome` or `/chrome` enables app browsing for future sessions.

## Phase 1: Understand the Idea

### Step 1: Get the seed

The user provides a rough idea as an argument or in conversation. It can be anything from a single phrase to a paragraph.

If no argument is provided, ask:

```
What's the idea you'd like to explore?
```

### Step 2: Read project context

```
Read docs/PROJECT_SPEC.md
```

Note the current phase, product vision, existing features, and what's planned vs. out of scope.

### Step 3: Check existing issues

```typescript
mcp__linear-server__list_issues({
  query: '<relevant keywords from the idea>',
  includeArchived: false,
  limit: 20,
})
```

Check if this idea (or parts of it) already exists as issues. Flag any overlaps.

### Step 4: Present initial take and ask questions

Share with the user:

- **Alignment**: How does this fit with the current phase and product vision?
- **Overlap**: Any existing issues that touch on this?
- **Initial scope thoughts**: What feels like the right size?

Then ask targeted questions to sharpen the idea. Focus on:

1. **Problem/motivation**: What's the user need or pain point?
2. **Scope boundaries**: What's in and what's explicitly out?
3. **User experience**: How should this feel to use? Key interactions?
4. **Edge cases**: What tricky scenarios should we consider?

If Chrome is available and the idea touches an existing part of the app, navigate to that area on staging (`https://honkadori.xyz/`) to see its current state. This grounds the conversation in reality rather than assumptions.

## Phase 2: Shape Through Discussion

### Step 5: Explore the codebase

Once the idea's direction is clear from initial discussion, scan the codebase for context:

- What related features already exist
- What patterns and infrastructure are in place
- What would need to be built from scratch vs. extended

Keep this focused (3-5 files max). The goal is feasibility context, not a full plan. Share relevant findings with the user.

### Step 6: Iterate

This is the core of the skill — a back-and-forth conversation to refine the idea. Keep it natural and collaborative. Don't rush to create issues.

Things to explore as the discussion develops:

- **Trade-offs**: Simpler approach vs. fuller feature? MVP vs. complete?
- **Splitting**: Is this one issue or several? What's the right granularity?
- **Priority**: Is this urgent, important, or nice-to-have?
- **Technical approach**: Any key decisions that affect scope or feasibility?
- **Dependencies**: Does this need anything built first?

Throughout iteration, **browse the app whenever it would sharpen the conversation** — when the user mentions a page, when you're discussing UX patterns, when debating what's already built vs. missing. Navigate, screenshot, and reference what you see. See "Browsing the app" below for the page map and guidance.

Continue the conversation until the idea feels well-defined and the user is ready to capture it.

## Phase 3: Create Issues

### Step 7: Draft the issue(s)

Present the proposed issue(s) to the user before creating them. For each issue, show:

```markdown
### Issue: [Title]

**Description:**
[What and why]

**Acceptance criteria:**
- [ ] [Specific, testable criterion]
- [ ] [Specific, testable criterion]

**Dependencies:** [blockedBy / blocks / relatedTo if any]
**Priority:** [Urgent / High / Medium / Low / None]
```

If there are multiple issues, also show the proposed relationships (order, dependencies, parent/child).

### Step 8: Get approval

Ask the user conversationally if the proposed issues look good to create. If they want changes, revise and ask again.

### Step 9: Create in Linear

For each approved issue:

```typescript
mcp__linear-server__save_issue({
  title: 'Issue title',
  team: 'Honkadori',
  description: 'Full description with acceptance criteria',
  // priority: 1-4 if set (1=Urgent, 2=High, 3=Medium, 4=Low)
  // blockedBy: ['HON-XX'],
  // blocks: ['HON-YY'],
  // relatedTo: ['HON-ZZ'],
  // parentId: 'parent-uuid' // if sub-issue
})
```

### Step 10: Summary

After creating all issues, summarize:

- Issues created (with HON-XX identifiers)
- Relationships between them
- Suggested next step (e.g., "Run `/plan-issue HON-XX` to plan the first one")

## Browsing the App

When Chrome tools are available, use them to bring visual context into the conversation. The staging app is at `https://honkadori.xyz/`.

### App page map

| Route                                 | Feature                                     |
| ------------------------------------- | ------------------------------------------- |
| `/`                                   | Today dashboard (meals, shopping, catch-up) |
| `/meal-plan`                          | Weekly meal plan with status controls       |
| `/shopping`                           | Shopping list with urgency grouping         |
| `/pantry`                             | Pantry inventory management                 |
| `/recipes`                            | Meal library browser                        |
| `/recipes/import`                     | AI recipe import from URL                   |
| `/household`                          | Household settings and members              |
| `/household/invites`                  | Invite link management                      |
| `/profile`                            | User profile and account settings           |
| `/onboarding`                         | New user setup flow                         |
| `/sign-in`, `/sign-up`               | Authentication                              |
| `/forgot-password`, `/reset-password` | Password recovery                           |
| `/invite/[code]`                      | Join household via invite                   |

### How to browse during ideation

- **Start with `tabs_context_mcp`** to see what's already open
- **Navigate** to relevant pages — screenshot and describe what you see
- **Keep it lightweight** — browse to ground the discussion, not to do a full review
- **Reference what you see** — "Looking at the shopping page, I can see X... so for this idea we'd want Y"
- **Don't block on auth** — if you can't access a page, describe it from code knowledge instead

### When to browse

Browse when it adds value, not by default. Good triggers:

- The idea involves changing an existing page or flow
- You're discussing UX and want to reference current patterns
- The user mentions something and you want to see the current state
- You need to understand spatial layout or visual hierarchy for the idea

Skip browsing when:

- The idea is for an entirely new feature with no existing UI
- The discussion is about backend/infrastructure
- The user is driving the conversation quickly and browsing would slow things down

## Guidelines

- **Interactive by default**: Don't rush past discussion to issue creation. The conversation IS the value.
- **Challenge scope**: Push back gently if an idea is too vague or too ambitious for a single issue.
- **Stay aligned**: Reference the project spec and current phase when relevant.
- **Sentence case**: Use sentence case for issue titles per project conventions.
- **Write implementation-ready issues**: Issues from ideation are fed into the autonomous agentic workflow (`/auto-implement`). They must contain enough context for an agent to build the feature without human guidance. After drafting the issue description and acceptance criteria, do a deeper codebase scan to add an **Implementation guidance** section with: key files to study (with line numbers and what to reuse), API/schema design, UI structure, and any non-obvious integration points. The agent won't have the ideation conversation — only the issue text. Self-review before creating: "Could an agent build this from the issue alone?"
- **Label appropriately**: Add labels if the idea clearly fits a category.
- **Browse naturally**: When Chrome is available, weave app browsing into the conversation as a natural information-gathering step — like checking a reference, not running a test suite.
