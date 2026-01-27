---
name: chrome-review
description: Interactive staging review session using Chrome. Explore the app, discuss findings, and create Linear issues collaboratively.
context: inherit
---

# Chrome Review Skill

You are conducting a collaborative staging review session with the user. Together you will explore the live app at `https://honkadori.xyz/`, observe behavior, discuss findings, and create Linear issues for anything worth tracking.

This is a **dialog**, not an automated scanner. The user drives focus and decisions. You provide structure, observations, and help create well-formed issues.

## Pre-flight

### Step 1: Verify Chrome mode

Check that Chrome browser tools are available. If not, stop and tell the user:

> This skill requires Chrome mode. Start a new session with `claude --chrome` or run `/chrome` to enable it.

### Step 2: Gather context

Read project context and existing backlog in parallel:

```
Read docs/PROJECT_SPEC.md
```

Fetch open and recently completed issues in parallel (split by state to avoid payload limits):

```typescript
// All open states — run these 4 calls in parallel
mcp__linear-server__list_issues({ project: '5a19627a-803f-4052-83c4-b44810d17af7', state: 'Backlog', limit: 50 })
mcp__linear-server__list_issues({ project: '5a19627a-803f-4052-83c4-b44810d17af7', state: 'Todo', limit: 50 })
mcp__linear-server__list_issues({ project: '5a19627a-803f-4052-83c4-b44810d17af7', state: 'In Progress', limit: 50 })
mcp__linear-server__list_issues({ project: '5a19627a-803f-4052-83c4-b44810d17af7', state: 'In Review', limit: 50 })
// Recent completions for context
mcp__linear-server__list_issues({ project: '5a19627a-803f-4052-83c4-b44810d17af7', state: 'Done', orderBy: 'updatedAt', limit: 20 })
```

Keep the backlog and recent completions in mind throughout the session to avoid creating duplicate issues. If a finding overlaps with an existing issue, mention it to the user.

### Step 3: Handle authentication

Navigate to `https://honkadori.xyz/`. If the user is already logged in, proceed. If not, discuss with the user — sign in with existing credentials or sign up. Handle the auth flow before continuing.

## Orientation

### Step 4: Discuss scope

Ask the user what they want to focus on. If they passed an argument (e.g., `/chrome-review shopping flow`), use that as the starting point.

Offer these options as conversation starters, not a rigid menu:

- **Broad sweep**: Walk through every major page systematically
- **Specific area**: Focus on a particular flow or feature
- **Recent changes**: Check recently merged PRs (`gh pr list --state merged --limit 10`) and review what shipped
- **Free exploration**: User guides navigation, you observe and comment

### App page map for reference

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
| `/sign-in`, `/sign-up`                | Authentication                              |
| `/forgot-password`, `/reset-password` | Password recovery                           |
| `/invite/[code]`                      | Join household via invite                   |

## Exploration Loop

### Step 5: Navigate and observe

For each area the user wants to review:

1. **Navigate** to the page on staging
2. **Screenshot** and analyze the visual state
3. **Check console** for errors, warnings, or failed network requests
4. **Test interactions** — click buttons, submit forms, navigate between states
5. **Surface observations** — present what you notice to the user

#### What to look for

- **Bugs**: Broken layouts, incorrect data, failed actions, console errors, dead links
- **UX issues**: Confusing flows, missing feedback, poor loading states, accessibility gaps
- **Feature opportunities**: Missing functionality, workflow friction, enhancement ideas
- **Performance**: Slow loads, unnecessary re-renders, large payloads
- **Content/polish**: Typos, inconsistent casing, missing empty states, rough edges

#### How to present findings

Be specific and visual. Describe what you see, where it is, and why it matters. Let the user decide what's worth filing. Don't oversell minor observations — state them plainly and move on if the user isn't interested.

## Issue Creation

### Step 6: Collaborative issue drafting

When the user agrees a finding is worth tracking:

1. **Propose** a title and description draft
2. **Discuss** with user — adjust scope, wording, priority
3. **Include** in the description:
   - What was observed (with screenshot if relevant)
   - Expected vs actual behavior (for bugs)
   - Why it matters (for UX/feature items)
   - Acceptance criteria (what does "done" look like?)
4. **Consider relationships** — does this relate to, block, or duplicate existing issues?

### Step 7: Create in Linear

```typescript
mcp__linear-server__create_issue({
    title: 'Agreed title in sentence case',
    team: 'Honkadori',
    project: '5a19627a-803f-4052-83c4-b44810d17af7',
    description: `## What
Description of the finding.

## Why
Why this matters.

## Acceptance criteria
- [ ] Criterion 1
- [ ] Criterion 2`,
    // Set these only when discussed with user:
    // priority: 3,
    // labels: ['bug'],
    // blockedBy: ['HON-XX'],
    // relatedTo: ['HON-YY'],
  })
```

Confirm creation and share the issue identifier with the user before moving on.

## Session Summary

### Step 8: Wrap up

When the user is done reviewing (or explicitly wraps up), provide:

- **Issues created**: List with identifiers and titles
- **Pages reviewed**: Which areas were covered
- **Not reviewed**: Areas that weren't reached (for a future session)
- **Observations skipped**: Anything noted but not filed, if worth remembering

## Guidelines

- **User drives**: Never create an issue without user agreement. Always discuss first.
- **Avoid duplicates**: Cross-reference findings with the existing backlog fetched in step 2. If a finding looks like a duplicate, flag it.
- **Be specific**: "The shopping list takes 3 seconds to load" is better than "performance could be improved."
- **Stay grounded**: Report what you actually observe. Don't speculate about issues you can't verify in the browser.
- **Sentence case**: All issue titles use sentence case per project conventions.
- **Keep momentum**: Don't over-discuss minor items. Quick observations can be quick conversations.
