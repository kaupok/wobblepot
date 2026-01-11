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

For each issue/suggestion in the review, assess:

**Scope fit**: Is this within the current issue/PR scope?
- In scope → lean toward addressing now
- Out of scope → lean toward deferring

**Severity**:
- 🔴 Critical → must address now
- 🟡 Suggestion → case-by-case based on scope/effort
- 🟢 Nitpick → usually defer unless quick fix

**Effort**:
- Quick fix (few lines, obvious change) → address now even if minor
- Significant work (new logic, refactoring) → only if critical or clearly in-scope

**Risk**:
- Security issue → always address now
- Bug that could affect users → address now
- Tech debt / style → can defer safely

### 4. Categorize

Place each item in one of three buckets:

- **Address Now**: Must be fixed before PR merge
- **Defer**: Valid feedback but out of scope; suggest creating follow-up issue
- **Skip**: Disagree with suggestion or not actionable (explain why)

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

- Be decisive - every item should end up in exactly one category
- Justify each decision briefly so the user understands the reasoning
- If disagreeing with a suggestion, explain why (the reviewer might have missed context)
- For deferred items, summarize what a follow-up issue would cover
- Keep output concise - focus on the decision, not re-explaining the original feedback
- If the review had no issues (APPROVE verdict), acknowledge that briefly

## Edge Cases

- **No review in conversation**: "No `/code-review` output found. Run `/code-review` first to generate feedback to triage."
- **Review was APPROVE with no issues**: "Review found no issues. Nothing to triage."
- **All items are critical**: Address all, note there's no room for deferral
