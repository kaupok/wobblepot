---
name: triage-code-review
description: Analyze review comments and decide what to address now vs later
context: inherit
agent: general-purpose
allowed-tools:
  - Read
---

# Triage Code Review

Analyze review feedback from `/code-review` and triage into actionable categories.

## Prerequisites

This skill expects `/code-review` output in the conversation history. If no review output is found, inform the user to run `/code-review` first.

## Workflow

### 1. Locate review output

Scan conversation history for the most recent `/code-review` output. Look for the structured format with "Issues" section containing 🔴 Critical, 🟡 Suggestions, and 🟢 Nitpicks.

### 2. Gather context

From the conversation, identify:
- The Linear issue being worked on (if mentioned)
- The PR scope (if discussed)
- The current task/goal

### 3. Evaluate each review item

For each issue/suggestion in the review, assess using **effort-first** thinking:

**Effort** (primary factor):
- Quick fix (few lines, < 5 min) → **address now**, regardless of severity
- Moderate fix (15-30 min, in scope) → **address now**
- Significant work (new feature, major refactor) → defer only if truly out of scope

**Severity** (secondary factor):
- 🔴 Critical → always address now, regardless of effort
- 🟡 Suggestion → address if quick or moderate effort
- 🟢 Nitpick → address if quick fix, otherwise skip

**The bias should be toward action.** Deferred items rarely get done. If something can be fixed in a few minutes, just fix it.

### 4. Categorize

Place each item in one of three buckets:

- **Address Now**: Fix before PR merge. Includes all quick fixes and anything critical.
- **Defer**: Only for significant work (hours, not minutes) that's genuinely out of scope. Must justify why it can't be a quick fix.
- **Skip**: Disagree with the suggestion or it's not actionable. Explain why.

## Output Format

```
## Review Triage

### Address Now
1. [Issue from review] - [Reason: scope/severity/effort justification]
2. [Issue from review] - [Reason]

### Defer
1. [Issue from review] - [Reason] → Consider creating follow-up issue for: [brief description]
2. [Issue from review] - [Reason]

### Skip
1. [Issue from review] - [Reason for disagreement or why not actionable]

### Recommended Next Steps
1. Fix [specific item] in [file:line]
2. Fix [specific item] in [file:line]
3. [If deferred items] Consider creating a follow-up issue for the deferred improvements
```

## Guidelines

- **Bias toward action** - when in doubt, address it now. Deferred items rarely get done.
- Be decisive - every item should end up in exactly one category
- Justify decisions briefly, especially for Skip (explain disagreement)
- **Defer is the last resort** - only for work that genuinely takes hours and is out of scope
- Keep output concise - focus on the decision and next steps
- If the review had no issues (APPROVE verdict), acknowledge that briefly

## Edge Cases

- **No review in conversation**: "No `/code-review` output found. Run `/code-review` first to generate feedback to triage."
- **Review was APPROVE with no issues**: "Review found no issues. Nothing to triage."
- **All items are critical**: Address all, note there's no room for deferral
