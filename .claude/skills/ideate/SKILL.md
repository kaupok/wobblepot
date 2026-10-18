---
name: ideate
description: Flesh out a rough idea into well-structured Linear issues through interactive discussion.
argument-hint: '<idea in a few words>'
context: inherit
---

# Ideate

Take a rough idea and shape it into actionable Linear issues through interactive discussion.

## Pre-flight

### Browser availability

If the session lists browser tools, you can browse the live app during ideation for visual context. Pick the browser by `docs/CHROME_TESTING.md` → Which browser: the T3 Code sidebar browser (`mcp__t3-code__preview_*`) first, then the Chrome extension, then the Playwright MCP. "When to browse" below says when it helps.

If no browser is listed, proceed without one.

## Asking in rounds

Every question this skill asks the user goes through this method. Step 4 asks the first round and Step 6 asks the rest.

Model the open decisions as a tree, because one decision can depend on the answer to another. The **frontier** is every open question whose prerequisites are already settled.

- **Ask the whole frontier in one round.** Do not ask one question per turn.
- **Give a recommended answer under each question, and word the question so "yes" accepts it.** The user can then answer "yes to all", or correct one number.
- **A question whose answer depends on another question in the same round waits for a later round.**
- **Look up facts; ask the user only for decisions.** When a question needs a fact from the codebase, Linear or staging, find it yourself (use a subagent if the lookup is wide), then ask only for the decision. A pending lookup holds back only the questions downstream of it.
- **The interview ends when the frontier is empty.** Then continue to Step 7.

Number the questions from Q1 in each round. Give each a title that says what it decides, so the user can answer without the earlier rounds in view (CLAUDE.md → Writing style).

```
❓ **Q1 — <title>**: <question, with choices if any>
➡️ <recommended answer>

❓ **Q2 — <title>**: ...
➡️ ...
```

After the user answers, lock the answers and work out the new frontier. An answer can open new questions, and it can close questions that no longer apply.

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

`list_issues` never returns relations, so before presenting any flagged overlap re-fetch it and read the structured fields:

```typescript
mcp__linear-server__get_issue({ id: 'HON-NNN', includeRelations: true })
```

Check `status`, `assignee`, and `relations.blockedBy` for each — a Done issue with an attached PR has shipped (build on it, don't re-plan it); an In Progress / assigned issue is someone's active work; an open `blockedBy` chain changes what the new idea can depend on. Present overlaps with that state attached, not just titles.

### Step 4: Present initial take and ask questions

Share with the user:

- **Alignment**: How does this fit with the current phase and product vision?
- **Overlap**: Any existing issues that touch on this?
- **Initial scope thoughts**: What feels like the right size?

Then ask the first round (see "Asking in rounds"). These four areas seed it. Drop an area the seed already answers, and look up what the codebase or Linear can tell you instead of asking:

1. **Problem/motivation**: What's the user need or pain point?
2. **Scope boundaries**: What's in and what's explicitly out?
3. **User experience**: How should this feel to use? Key interactions?
4. **Edge cases**: What tricky scenarios should we consider?

If a browser is available and the idea touches an existing part of the app, navigate to that area on staging (`https://wobblepot.dev/`) to see its current state. This grounds the conversation in reality rather than assumptions.

## Phase 2: Shape Through Discussion

### Step 5: Explore the codebase

Once the idea's direction is clear from initial discussion, scan the codebase for context:

- What related features already exist
- What patterns and infrastructure are in place
- What would need to be built from scratch vs. extended

Read only what the feasibility question depends on. The goal is feasibility context, not a full plan. Share relevant findings with the user.

### Step 6: Iterate in rounds

This is the core of the skill: ask rounds (see "Asking in rounds") until the idea is well-defined. Keep it collaborative. Don't rush to create issues.

These topics seed later rounds as the discussion develops:

- **Trade-offs**: Simpler approach vs. fuller feature? MVP vs. complete?
- **Splitting**: Is this one issue or several? What's the right granularity?
- **Priority**: Is this urgent, important, or nice-to-have?
- **Technical approach**: Any key decisions that affect scope or feasibility?
- **Dependencies**: Does this need anything built first?

Throughout iteration, **browse the app whenever it would sharpen the conversation** — when the user mentions a page, when you're discussing UX patterns, when debating what's already built vs. missing. Navigate, screenshot, and reference what you see. See "Browsing the app" below for the page map and guidance.

The interview ends when the frontier is empty: every open decision has an answer. Then continue to Step 7.

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

Prefix the title with `[DRAFT]` when the spec is not ready to implement; never `[AUTO DRAFT]`, which only `/auto-implement` files (`/refine-backlog` → "Title prefixes"). Create the issue in Backlog.

```typescript
mcp__linear-server__save_issue({
  title: 'Issue title',
  team: 'Wobblebot',
  state: 'Backlog',
  description: 'Full description with acceptance criteria',
  // priority: 1-4 if set (1=Urgent, 2=High, 3=Medium, 4=Low)
  // blockedBy: ['HON-XX'],
  // blocks: ['HON-YY'],
  // relatedTo: ['HON-ZZ'],
  // parentId: 'parent-uuid' // if sub-issue
})
```

Reference other issues in descriptions as plain text (`HON-NNN`), never hand-copied `<issue id="…">` tags — Linear auto-resolves plain text on save, and a copied UUID controls where the link goes, so it can silently point at the wrong issue.

**Never nest a markdown table inside a list item.** Linear's description parser silently strips the list item's content indent — 3 characters under `1. `, 2 under `- ` — off the front of every table _body_ cell. The header and delimiter rows survive, so the table still looks right while `` `MealForm.tsx:153` `` has become `` alForm.tsx:153` ``: data loss, not a rendering glitch, and nothing reports it. Put the table at top level before or after the list, or use a nested bullet list instead. Top-level tables and tables inside a blockquote are safe. See CLAUDE.md → Writing for Agents.

### Step 10: Summary

After creating all issues, summarize:

- Issues created (with HON-XX identifiers)
- Relationships between them
- Suggested next step (e.g., "Run `/plan-issue HON-XX` to plan the first one")

## Browsing the App

When a browser is available, use it to bring visual context into the conversation. The staging app is at `https://wobblepot.dev/`.

### App page map

Page map: see `docs/CHROME_TESTING.md` → Page map (regenerate from `find src/app -name page.tsx` if routes changed). It also lists the redirect stubs (`/meal-plan`, `/household/invites`) — landing on their targets is expected behaviour, not a bug.

### How to browse during ideation

- **Start with what's already open**: `preview_status` in the T3 Code sidebar browser, `tabs_context_mcp` in the Chrome extension, `browser_tabs` in the Playwright MCP
- **Navigate** to relevant pages and describe what you see. In the T3 Code sidebar the user sees the same tab, so say what matters and do not paste every screenshot
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

- **Interactive by default**: Don't rush past discussion to issue creation. The conversation IS the value. The interaction is rounds of numbered questions, each with a recommended answer, not one question per turn.
- **Challenge scope**: Push back gently if an idea is too vague or too ambitious for a single issue.
- **Stay aligned**: Reference the project spec and current phase when relevant.
- **Sentence case**: Use sentence case for issue titles per project conventions.
- **Write agent-ready issues**: Issues from ideation feed into the agentic workflow (`/auto-implement`, but also product and design agents). They must contain enough context and reasoning for an agent to act without the ideation conversation. Include the problem/motivation, not just the solution. After drafting the description and acceptance criteria, do a deeper codebase scan to add an **Implementation guidance** section with: key files to study (with line numbers and what to reuse), API/schema design, UI structure, and any non-obvious integration points. Self-check before creating: "Could an agent complete this from the issue alone?"
- **Label appropriately**: Add labels if the idea clearly fits a category.
- **Browse naturally**: Weave app browsing into the conversation as a natural information-gathering step — like checking a reference, not running a test suite.
