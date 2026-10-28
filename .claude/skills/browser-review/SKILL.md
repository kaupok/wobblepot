---
name: browser-review
description: Interactive staging review session in a browser (the T3 Code sidebar first, then the Chrome extension or the Playwright MCP). Explore the app, discuss findings, and create Linear issues collaboratively.
context: inherit
---

# Browser Review Skill

You are conducting a collaborative staging review session with the user. Together you will explore the live app at `https://wobblepot.dev/`, observe behavior, discuss findings, and create Linear issues for anything worth tracking.

This is a **dialog**, not an automated scanner. The user drives focus and decisions. You provide structure, observations, and help create well-formed issues.

## Pre-flight

### Step 1: Pick a browser

Pick the browser by `docs/BROWSER_TESTING.md` → Which browser: the T3 Code sidebar browser (`mcp__t3-code__preview_*`) first, then the Chrome extension (`mcp__claude-in-chrome__*`), then the Playwright MCP (`mcp__playwright__browser_*`). Use the tool names of the set you picked for the rest of the session. `docs/BROWSER_TESTING.md` → Tool mapping pairs the T3 Code and Playwright names; the Chrome extension's tools are listed in the session.

In the T3 Code sidebar the user sees the tab you drive, so describe what matters and do not paste every screenshot.

If none of the three is listed, stop and tell the user:

> This skill needs a browser. Open the session in T3 Code to use its sidebar browser, start Claude Code with `claude --chrome` (or run `/chrome`) for the Chrome extension, or enable the Playwright MCP in `.claude/settings.local.json`.

### Step 2: Gather context

Read four sections of the design guide. They are contiguous, from `## Composition rules` to the end of `## Reject list`:

```
Read docs/DESIGN.md → ## Composition rules, ## Copy, ## Focus management, ## Reject list (find the line range with grep -n '^## ' docs/DESIGN.md)
```

The **Reject list** and **Composition rules** are the named items a design finding cites (HON-615). **Copy** holds the on-screen text rules (sentence case, empty states, error wording, recipe versus meal), and **Focus management** describes focus that falls to `<body>`, which only driving the page shows. A copy or focus problem is a finding too; it cites its own section, not the design items.

Read another section only when a finding needs it: **Type scale** to judge a title size, **Primitives** for the icon rules, **Motion** for a transition. Do not read `docs/PROJECT_SPEC.md` up front. When a finding turns on product intent ("is this how it should work?"), grep the spec for that feature then.

Do not fetch the backlog up front. Check for a duplicate per finding instead, in step 6.

### Step 3: Handle authentication

Navigate to `https://wobblepot.dev/`. If the user is already logged in, proceed. If not, discuss with the user — sign in with existing credentials. Handle the auth flow before continuing.

Do not sign up on staging. Sign-up and onboarding are reviewed on the local review server instead: start `pnpm review:local` in the background, wait for the line containing `REVIEW-READY http://localhost:3200`, and walk the flow there with a minted invite code and test credentials — see `docs/BROWSER_TESTING.md` → "Reviewing sign-up and onboarding". If the Neon branch cap is full, the error names `pnpm review:local --db env`; that mode writes to the `.env` database, so run the cleanup in that section afterwards.

## Orientation

### Step 4: Discuss scope

Ask the user what they want to focus on. If they passed an argument (e.g., `/browser-review shopping flow`), use that as the starting point.

Offer these options as conversation starters, not a rigid menu:

- **Broad sweep**: Walk through every major page systematically
- **Specific area**: Focus on a particular flow or feature
- **Recent changes**: Check recently merged PRs (`gh pr list --state merged --limit 10`) and review what shipped
- **Free exploration**: User guides navigation, you observe and comment

### App page map for reference

Page map: see `docs/BROWSER_TESTING.md` → Page map (regenerate from `find src/app -name page.tsx` if routes changed). It also lists the redirect stubs (`/meal-plan`) — landing on their targets is expected behaviour, not a bug.

Default itinerary for a broad sweep — start here, then branch out using the full map:

1. `/` — Today dashboard (landing page when signed out)
2. `/recipes` — Meal library, plus `/recipes/create`, `/recipes/imagine`, `/recipes/import`
3. `/shopping` and `/pantry` — Shopping list and pantry (two columns from `md` up, separate tabs on a phone)
4. `/past-meals` — The past 7 days, to mark meals cooked or skipped
5. `/household` — Household tabs: Members, Meal preferences (`/household/meal-preferences`), Ingredients (`/household/ingredients`), Settings (`/household/settings`)
6. `/account` — My account tabs: Profile, Reminders, Connections, Your data
7. `/sign-up` → `/onboarding` → `/` — Sign-up, create-household and first-plan flow. **Review it on the local review server, not on staging:** staging 404s the invite-code minter and a review must not create accounts on a deployed host. Start `pnpm review:local` in the background, wait for the `REVIEW-READY http://localhost:3200` line, then follow `docs/BROWSER_TESTING.md` → "Reviewing sign-up and onboarding" for the invite code, test credentials and cleanup

## Exploration Loop

### Step 5: Navigate and observe

Review in English at desktop width. Switch the household to Estonian, or the browser to a phone width (390px, `preview_resize` or `browser_resize`), only when the user asks for it.

For each area the user wants to review:

1. **Navigate** to the page on staging
2. **Screenshot** and analyze the visual state
3. **Check console** for errors, warnings, or failed network requests. The T3 Code sidebar has no console or network tool. Find failed requests with `preview_evaluate` on `performance.getEntriesByType('resource').filter(e => e.responseStatus >= 400).map(e => [e.name, e.responseStatus])`. It cannot read past console messages, so when a finding needs them, reproduce it in the Playwright MCP (`browser_console_messages`, `browser_network_requests`) and say so
4. **Test interactions** — click buttons, submit forms, navigate between states. Staging holds the user's real account, so ask before an action you cannot undo, such as deleting the account or leaving the household. An action the app can undo, such as deleting a recipe, needs no question
5. **Surface observations** — present what you notice to the user

#### What to look for

- **Bugs**: Broken layouts, incorrect data, failed actions, console errors, dead links
- **UX issues**: Confusing flows, missing feedback, poor loading states, accessibility gaps
- **Feature opportunities**: Missing functionality, workflow friction, enhancement ideas
- **Performance**: Slow loads, unnecessary re-renders, large payloads
- **Content/polish**: Typos, inconsistent casing, missing empty states, rough edges
- **Design guide**: Anything on the `docs/DESIGN.md` **Reject list**, or a **Composition rule** not followed. Name the item when you present it, so the user can check it against the document

#### How to present findings

Be specific and visual. Describe what you see, where it is, and why it matters. Let the user decide what's worth filing. Don't oversell minor observations — state them plainly and move on if the user isn't interested.

## Issue Creation

### Step 6: Collaborative issue drafting

When the user agrees a finding is worth tracking:

1. **Check for a duplicate**: `mcp__linear-server__list_issues({ team: 'Wobblebot', query: '<two or three words from the finding>', limit: 10 })`, then a second query with a synonym or the screen name. If an open issue covers it, show it to the user and offer to add to it instead. If a Done issue covers it, the finding may be a regression: say so. Before you set a relation, fetch the related issue with `get_issue` and `includeRelations: true`
2. **Propose** a title and description draft
3. **Discuss** with user — adjust scope, wording, priority
4. **Include** in the description:
   - What was observed. Attach a screenshot after creation, in step 7
   - Where: the route, and the component file that renders it (grep for the visible text or a label from the catalogs)
   - Expected vs actual behavior (for bugs)
   - Why it matters (for UX/feature items)
   - Acceptance criteria (what does "done" look like?)

**Design findings.** When the finding matches a named item in `docs/DESIGN.md`, cite the item under **Why** — that is what separates a design finding from a taste preference. When it is a recurring pattern the document does not name, offer the user two things rather than one: the fix issue, and a one-line addition to the **Reject list** (a small docs PR, or a note appended to the fix issue's acceptance criteria). Naming it is how the guide stops being a static document (HON-615).

### Step 7: Create in Linear

Create the issue in **Queued** when an agent can finish it alone, per CLAUDE.md → File and queue by default. Use **Todo** when it has a human-only step, and **Backlog** with `[DRAFT]` when the spec is not ready. When you pick Todo or Backlog, tell the user why in one sentence.

```typescript
mcp__linear-server__save_issue({
    title: 'Agreed title, per CLAUDE.md → Issue titles',
    team: 'Wobblebot',
    state: 'Queued', // 'Todo' for a human-only step, 'Backlog' for a [DRAFT]
    description: `## What
Description of the finding.

## Where
Route and component file, e.g. \`/shopping\` → \`src/components/inventory/ShoppingListHeader.tsx\`.

## Why
Why this matters.

## Acceptance criteria
- [ ] Criterion 1
- [ ] Criterion 2`,
    // Set these only when discussed with user:
    // priority: 3,
    // labels: ['Bug'],
    // blockedBy: ['HON-XX'],
    // relatedTo: ['HON-YY'],
  })
```

**Attach the screenshot** when the finding is visual. Save it to disk (`preview_snapshot` with `save: true` returns `screenshotPath`; Playwright: `browser_take_screenshot`). Then, one file at a time, because the signed URL expires in 60 seconds:

1. `mcp__linear-server__prepare_attachment_upload({ issue, filename, contentType: 'image/png', size })`, with `size` from `stat -f%z <path>`.
2. `curl -X PUT --data-binary @<path>` to `uploadRequest.url`, with every header in `uploadRequest.headers` sent verbatim.
3. `mcp__linear-server__create_attachment_from_upload({ issue, assetUrl })`.

The Chrome extension cannot save a screenshot file, so describe the screen in the issue instead.

Confirm creation before moving on. Name the issue by what it fixes, with its identifier in parentheses (CLAUDE.md → Name the thing, not its number).

## Session Summary

### Step 8: Wrap up

When the user is done reviewing (or explicitly wraps up), provide:

- **Issues created**: each by what it fixes, with its identifier in parentheses
- **Pages reviewed**: Which areas were covered
- **Not reviewed**: Areas that weren't reached (for a future session)
- **Observations skipped**: Anything noted but not filed, if worth remembering

## Guidelines

- **User drives**: Never create an issue without user agreement. Always discuss first.
- **Avoid duplicates**: Search Linear for each finding before you draft it (step 6). If a finding looks like a duplicate, flag it.
- **Be specific**: "The shopping list takes 3 seconds to load" is better than "performance could be improved."
- **Stay grounded**: Report what you actually observe. Don't speculate about issues you can't verify in the browser.
- **Titles**: Follow CLAUDE.md → Issue titles.
- **Keep momentum**: Don't over-discuss minor items. Quick observations can be quick conversations.
