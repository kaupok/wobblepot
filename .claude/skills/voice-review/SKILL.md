---
name: voice-review
description: Voice-powered staging review session using Chrome and VoiceMode. Talk through the app, discuss findings, and create Linear issues collaboratively.
context: inherit
---

# Voice Review Skill

You are conducting a collaborative staging review session with the user using **voice communication**. Together you will explore the live app at `https://wobblepot.dev/`, discuss observations by talking, and create Linear issues for anything worth tracking.

This is a **spoken dialog** — all communication goes through VoiceMode. Text output is secondary (issue IDs, final summary for copy-paste reference).

## Pre-flight

### Step 1: Verify Chrome mode

Check that Chrome browser tools are available. If not, stop and output as text (voice is not yet verified):

> This skill requires Chrome mode. Start a new session with `claude --chrome` or run `/chrome` to enable it.

### Step 2: Verify and start VoiceMode services

Check that Whisper (STT), Kokoro (TTS), and VoiceMode (HTTP server) are running:

```typescript
// Run in parallel
mcp__voicemode__service({ service_name: 'whisper', action: 'status' })
mcp__voicemode__service({ service_name: 'kokoro', action: 'status' })
mcp__voicemode__service({ service_name: 'voicemode', action: 'status' })
```

If any service is not running, start it:

```typescript
mcp__voicemode__service({ service_name: 'whisper', action: 'start' })
mcp__voicemode__service({ service_name: 'kokoro', action: 'start' })
mcp__voicemode__service({ service_name: 'voicemode', action: 'start' })
```

If services fail to start, output a text message directing the user to `docs/VOICE_REVIEW.md` for setup instructions. Do not continue.

### Step 3: Gather context

Read project context and existing backlog in parallel:

```
Read docs/PROJECT_SPEC.md
```

Fetch open and recently completed issues in parallel (split by state to avoid payload limits):

```typescript
// All open states — run these 4 calls in parallel
mcp__linear-server__list_issues({ state: 'Backlog', limit: 50 })
mcp__linear-server__list_issues({ state: 'Todo', limit: 50 })
mcp__linear-server__list_issues({ state: 'In Progress', limit: 50 })
mcp__linear-server__list_issues({ state: 'In Review', limit: 50 })
// Recent completions for context
mcp__linear-server__list_issues({ state: 'Done', orderBy: 'updatedAt', limit: 20 })
```

Keep the backlog and recent completions in mind throughout the session to avoid creating duplicate issues. If a finding overlaps with an existing issue, mention it to the user.

### Step 4: Handle authentication

Navigate to `https://wobblepot.dev/`. If the user is already logged in, proceed. If not, **speak** to ask about credentials and handle the auth flow before continuing.

## Orientation

### Step 5: Greet and discuss scope

**Speak** a greeting and ask what the user wants to focus on. If they passed an argument (e.g., `/voice-review shopping flow`), use that as the starting point.

```typescript
mcp__voicemode__converse({
  message: "Hey! I'm ready to review the app with you. What area would you like to focus on? We could do a broad sweep of everything, look at a specific feature, check what's changed recently, or you can just guide me through whatever you'd like.",
  tts_provider: 'kokoro',
})
```

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

### Step 6: Navigate and observe

For each area the user wants to review:

1. **Speak** what you're about to do (use `wait_for_response: false` for brief status updates)
2. **Navigate** to the page on staging
3. **Screenshot** and analyze the visual state
4. **Check console** for errors, warnings, or failed network requests
5. **Test interactions** — click buttons, submit forms, navigate between states
6. **Speak observations** — present what you notice to the user, listen for their response

```typescript
// Status update while navigating (don't wait for response)
mcp__voicemode__converse({
  message: "Taking a look at the shopping list page now.",
  tts_provider: 'kokoro',
  wait_for_response: false,
})

// After analyzing, discuss findings (wait for response)
mcp__voicemode__converse({
  message: "I see the shopping list is grouping items by urgency, but there's a console warning about a missing key prop in the list. The layout looks good on desktop though. Want me to file that console warning?",
  tts_provider: 'kokoro',
})
```

#### What to look for

- **Bugs**: Broken layouts, incorrect data, failed actions, console errors, dead links
- **UX issues**: Confusing flows, missing feedback, poor loading states, accessibility gaps
- **Feature opportunities**: Missing functionality, workflow friction, enhancement ideas
- **Performance**: Slow loads, unnecessary re-renders, large payloads
- **Content/polish**: Typos, inconsistent casing, missing empty states, rough edges

#### Voice communication style

- Keep messages conversational and concise — avoid reading out long technical details
- Be specific about what you see and where
- Ask clear yes/no questions when possible
- State observations plainly; let the user decide importance
- Use `wait_for_response: false` for quick status updates during navigation

## Issue Creation

### Step 7: Collaborative issue drafting

When the user agrees a finding is worth tracking:

1. **Speak** a proposed title and brief description
2. **Listen** for confirmation or adjustments
3. Include in the written description:
   - What was observed (with screenshot if relevant)
   - Expected vs actual behavior (for bugs)
   - Why it matters (for UX/feature items)
   - Acceptance criteria (what does "done" look like?)
4. **Consider relationships** — does this relate to, block, or duplicate existing issues?

### Step 8: Create in Linear

```typescript
mcp__linear-server__save_issue({
  title: 'Agreed title in sentence case',
  team: 'Honkadori',
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

After creating, **speak** the issue identifier and also output it as text so the user can reference it later:

```typescript
mcp__voicemode__converse({
  message: "Created issue HON-42. Moving on — what's next?",
  tts_provider: 'kokoro',
})
```

## Session Summary

### Step 9: Wrap up

When the user is done reviewing (or explicitly wraps up), **speak** a summary:

```typescript
mcp__voicemode__converse({
  message: "Alright, good session! We reviewed 4 pages and created 3 issues. We didn't get to the pantry or profile pages — maybe next time. Thanks!",
  tts_provider: 'kokoro',
  wait_for_response: false,
})
```

Also output a **text summary** for reference:

- **Issues created**: List with identifiers and titles
- **Pages reviewed**: Which areas were covered
- **Not reviewed**: Areas that weren't reached (for a future session)
- **Observations skipped**: Anything noted but not filed, if worth remembering

## Guidelines

- **Voice first**: All communication goes through `mcp__voicemode__converse`. Text is secondary for reference only.
- **Always use `tts_provider: "kokoro"`**: Local TTS, no OpenAI API key required.
- **User drives**: Never create an issue without user agreement. Always discuss first.
- **Avoid duplicates**: Cross-reference findings with the existing backlog fetched in step 3.
- **Be specific**: "The shopping list takes 3 seconds to load" beats "performance could be improved."
- **Stay grounded**: Report what you actually observe. Don't speculate about issues you can't verify.
- **Sentence case**: All issue titles use sentence case per project conventions.
- **Keep momentum**: Quick observations can be quick conversations. Don't over-discuss minor items.
- **Concise speech**: Keep voice messages short and natural. Save technical details for the written issue.
