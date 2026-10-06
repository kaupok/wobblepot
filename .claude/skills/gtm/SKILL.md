---
name: gtm
description: Continue go-to-market work. Reads the plan from Linear, reports where it stands, works one topic (market, positioning, pricing, first cohort, waitlist, channels, launch), and writes the result back to Linear. Use whenever the user wants to talk about or advance go-to-market.
argument-hint: '[status | review | <topic in a few words>]'
context: inherit
---

# Go-to-market

Go-to-market work runs over many sessions, and a new session knows nothing of the last one. This skill is the way back in: it loads the state from Linear, moves one topic forward with the user, and leaves the state current for the next session.

This is a **dialog**. The user (the maker) decides. You bring the facts, the options and a recommendation.

**This file is in a public repository.** It holds the method only. It holds no plan content: no market, price, date, target, channel name or household. Those live in Linear, and you read them from there every time.

## Modes

- `/gtm` or `/gtm status` — say where go-to-market stands and what comes next. Correct the plan where it is out of date. Do no other work.
- `/gtm review` — a status, plus the numbers: compare what the plan expected by today with what happened, and propose changes to the plan.
- `/gtm <topic>` — work that topic with the user: a decision, a piece of research, a text, a set of issues.

## Rules for every mode

### 1. Go-to-market content lives in Linear, never in the repository

The repository is public, so a plan, a price or a cohort result written there is published.

| Content                                                    | Where it goes                                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| The plan, its phases, every decision                       | Linear document `GTM plan`                                                    |
| How to run the first cohort (scripts, questions, consent)  | Linear document `GTM playbook: first cohort`                                  |
| Research (competitors, prices, channels, communities)      | A new Linear document `GTM research: <topic> (<YYYY-MM-DD>)`                  |
| Evidence (usage, cost, a product audit)                    | A new Linear document `GTM evidence: <topic> (<YYYY-MM-DD>)`                  |
| A piece of work                                            | A Linear issue with the `GTM` label                                           |
| A product change that go-to-market needs                   | A normal PR. Its text says what changes for the user, not the strategy behind |
| Names, emails or phone numbers of households in the cohort | Nowhere you write. The maker keeps a private tracker                          |

All documents attach to the `Wobblebot` team. A research or evidence document is a dated snapshot: do not rewrite an old one. Write a new one and link it from the plan.

### 2. The subject is households outside the maker's family

Do not measure, judge or put a gate on the maker's own use of the product. The maker's household uses it at its own pace, and it is not evidence about strangers.

### 3. The maker decides, you recommend

- Mark every choice you make as a recommendation until the maker confirms it.
- When the maker decides, record the decision with its date in the plan and in the issue. Record the reason only if the maker gave one.
- Do not reopen a decided item. If new evidence speaks against it, show the evidence and ask once.

### 4. Build on what you verified

- Check a fact at its source before work depends on it: a competitor's closing date, a community's posting rule, a price.
- Give each number its source and its date.
- Write "not verified" next to what you could not check. A wrong fact in the plan costs the maker a real post or a real invite.

### 5. A public claim must be true of the product today

Before you propose copy for the landing page, an invite or a post, read the code path behind each claim. Copy that promises a step the product does not have sends a new household in with a wrong picture. If the claim is false today, say so and offer both fixes: change the copy, or change the product.

### 6. The maker speaks to the outside world

Do not post in a community, send an email or a message, register an account, or spend money. Draft the text and say where it goes. The maker sends it. This holds even when a mail or browser tool is available in the session.

### 7. Write so the maker can decide in one read

`CLAUDE.md` → Writing style applies, and most of all "Name the thing, not its number": the maker does not know an issue from its ID or a phase from its number.

- Put a decision as a question that carries the trade-off, then your recommendation and one sentence of reason.
- Ask at most three decisions in one message. Lead with the one that blocks the most.

### 8. Linear rules

`CLAUDE.md` → Git & Workflow Essentials applies: `get_issue` with `includeRelations: true`, `[DRAFT]` for an issue whose spec is not ready, `blockedBy` in the call that creates the issue, human-only work goes to Todo, and moving an issue to Queued is the maker's act.

## Step 1: Load the state

Run in parallel:

```typescript
mcp__linear-server__list_documents({ query: 'GTM', limit: 50 })
mcp__linear-server__list_issues({ team: 'Wobblebot', label: 'GTM', limit: 100 })
```

Then:

1. Read the document `GTM plan` in full with `get_document`. It names the phases, the gates, the open decisions and the companion documents. Read its `Log` section last: it says what the previous sessions did.
2. Read a companion document only when the topic needs it.
3. For each issue you will talk about, call `get_issue` with `includeRelations: true` and read `status`, `assignee` and `relations.blockedBy`.

If no `GTM plan` document exists, say so and stop. Do not rebuild a plan from this file or from the issues without the maker asking for it.

## Step 2: Find what changed

Compare the plan with today:

- Which `GTM` issues changed state since the last `Log` entry? `list_issues` with `updatedAt` finds them.
- Which dates in the plan have passed? Which gate is next, and when?
- Which sentences in the plan are now false? An issue the plan calls "waiting" may be merged.

For `/gtm review`, or when a number decides the topic, read the measurements:

- Product use: the PostHog project `mealplan-production`, dashboard `GTM: beta cohort`. Follow the PostHog MCP's own instructions, and set the active project back when you finish.
- Those insights count people who accepted analytics cookies, not households. Say so with every number.
- The maker's private tracker is the second source. Ask the maker for the counts. Never ask for names.
- Test a new or changed query on the staging project before you save it on production.

## Step 3: Report

Open every mode with this, in chat, in plain words:

1. **Where we are.** One or two sentences. Name the phase by what it does ("the first cohort of invited households"), not by its number.
2. **What moved** since the last session.
3. **What is late or at risk**, with the date.
4. **Waits for you.** At most three decisions, each as a question with a recommendation.
5. **I can do now.** At most three actions that need no decision.

`/gtm status` ends after this report and Step 5.

## Step 4: Work the topic

Pick the kind of work the topic needs:

- **A decision.** Lay out the options, what each costs, and what the evidence documents say. Recommend one. After the maker answers, record it (rule 3) and update every issue the decision touches.
- **Research.** Go to first-hand sources (rule 4). Write a new dated research document: the finding first, then the sources, then what stays unknown. Put the two or three facts that change the plan into the plan, with a link to the document.
- **A text**: landing copy, an invite message, a community post, an email. Check each claim against the product (rule 5). Landing copy becomes an issue that names the catalog keys in `messages/en.json` and `messages/et.json` (`CLAUDE.md` → Localization). A text the maker sends goes into the playbook or its own document (rule 6).
- **A product change.** Write the issue with the `GTM` label. The why is the go-to-market reason, and it belongs in the issue, not in the code or the PR. Use `[DRAFT]` unless the spec is complete, then hand it to `/refine-backlog` or `/plan-issue`. Implement it in this session only when the maker asks, and then on a branch through the normal PR flow.
- **A measurement.** Define what counts, in words, before you build the insight. Say what the number cannot see.
- **Running the cohort.** Work from the playbook. Each problem a household reports becomes an issue with the `GTM` label, in the household's words, without the household's name.

## Step 5: Write the state back

Do this before the session ends, whenever something changed. The next session has only Linear.

1. **Patch the plan, do not rewrite it.** Use `save_document` with `patch`. Keep the section numbers stable, because issues and other documents cite them.
2. **Add one line to the plan's `Log` section:** the date, then what changed or was decided, in plain words. Create the section at the end of the plan if it is missing.
3. **Link every new document** from the plan's list of companion documents.
4. **Correct the false sentences** you found in Step 2.

Two Linear behaviours to know:

- Linear stores an issue reference as a tag, not as the text `HON-123`. A `patch` whose `old_string` contains an issue ID or a link does not match. Anchor on plain words next to it, and use `replace_range` to replace a span that contains a reference.
- Do not put a table inside a list item (`CLAUDE.md` → Writing for Agents).

If the session changed **how** go-to-market work is done (a new rule, a new kind of document), that belongs in this file, through a PR. Keep the rule free of plan content.

## Step 6: Close

End with a short summary in chat:

- What you changed, each with a link to the document or issue.
- What the maker decided in this session.
- What waits for the maker next, most urgent first.
