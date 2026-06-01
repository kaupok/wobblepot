---
name: next-issue
description: Find the next unblocked Linear issue to work on. Use when user says "continue implementation" or asks what to work on next.
argument-hint: '[--auto]'
context: fork
agent: general-purpose
allowed-tools:
  - mcp__linear-server__list_issues
  - mcp__linear-server__get_issue
  - Read
  - Grep
  - Glob
---

# Next Issue Finder

Find the next unblocked issue and return a concise implementation summary.

## Modes

- **Default:** find any unblocked, unclaimed issue ready to implement.
- **No-human-input mode (`--auto`):** only surface issues that `/auto-implement` can complete end-to-end without a human in the loop — no open decisions, no missing configuration, no provisioning, no design/legal review. Applies **extra** filters in step 5 — everything else identical.

## Arguments

- `--auto` — enable no-human-input mode. **Must be passed explicitly as the literal token `--auto` in the skill invocation's args.** Never infer auto mode from natural-language phrasing, prior conversation, or surrounding context. This skill has previously triggered auto mode without the flag (twice as of 2026-05-07); the explicit flag is now the *only* path in.

## Workflow

0. **Parse arguments**

   Default: `autoMode = false`.

   Set `autoMode = true` **only** if the skill invocation's `command-args` (or equivalent argument string) contains the literal token `--auto`. Do not infer it from:
   - The user's natural-language prompt accompanying the invocation
   - Prior conversation turns
   - Project context, the current phase, or what "would make sense"
   - A bare `/next-issue` invocation with no args

   If unsure, `autoMode = false`. The user can always re-run with `--auto` if they wanted it; the inverse (silently filtering out issues the user wanted to see) is the failure mode this rule prevents.

1. **Read project context**

   ```
   Read docs/PROJECT_SPEC.md
   ```

   Review for current phase and relevant context.

2. **List unassigned Backlog and Todo issues**

   Always pass `assignee: "null"` — never list all issues and filter client-side. Never list issues with any other state (In Progress / In Review / Done / Canceled issues are already claimed or complete).

   ```
   mcp__linear-server__list_issues({ state: "Todo",    assignee: "null", limit: 20 })
   mcp__linear-server__list_issues({ state: "Backlog", assignee: "null", limit: 20 })
   ```

3. **MANDATORY: Verify every candidate with `includeRelations: true`**

   Before a candidate can enter the output list, re-fetch it:

   ```
   mcp__linear-server__get_issue({ id: "HON-XX", includeRelations: true })
   ```

   This is non-negotiable. `list_issues` does not return the `relations` field, so blockers are invisible without this step.

4. **Hard filters — reject the candidate if ANY of these fail**

   - `status` must be one of: `Backlog`, `Todo`. Reject `In Progress`, `In Review`, `Done`, `Canceled`, `Triage`.
   - `assignee` must be `null`. Reject any issue with an assignee, even "me" — it's already claimed.
   - Every id in `relations.blockedBy` must resolve to a `status` of `Done` or `Canceled`. An empty `blockedBy` array passes. An open blocker (Backlog / Todo / In Progress / In Review) fails.
   - `statusType` must not be `triage` or `canceled`.

   If any filter rejects the candidate, discard it and pick another — **do not downgrade the candidate to a "caveat" or include it anyway**. Silent failures here are the primary failure mode this skill exists to prevent.

5. **No-human-input mode — additional filters (only when `autoMode` is true)**

   When `autoMode` is true, also reject the candidate if the description or acceptance criteria imply any of:

   - Third-party account provisioning (Upstash, PostHog, Sentry, Resend, Chromatic, Anthropic console, etc.)
   - New environment variables / secrets on Vercel or elsewhere
   - DNS changes (SPF/DKIM/DMARC, subdomain setup, registrar actions)
   - Legal / copy review (privacy policy text, ToS, company entity details, parental consent wording)
   - Design assets (OG images, branded graphics, mockups)
   - Ops access (authenticated CLI like `neonctl` against production, Vercel dashboard edits, GitHub org settings)
   - Shared-state side effects (staging DB writes that can't be reset, sending real emails, outbound API calls that cost money)
   - Subjective human review — the acceptance criteria require a human to *validate quality*, not just to provide inputs. An agent can produce the artifact but cannot close the ticket. Covers: native-speaker / native-judgment work (voice, tone, register, idiom), copy or naming quality review, design polish review, and any AC that name-drops a specific reviewer ("does Kaupo read this and…"). Distinct from "legal / copy review" — that's about *clearance*; this is about *taste*.

   Skim for red-flag phrases: "add env var", "add secret", "configure DNS", "sign up", "provision", "API key", "`support@`", "legal entity", "OÜ", "Resend", "Upstash", "PostHog", "Sentry", "Anthropic console", "Vercel dashboard", "manual spot-check", "reads natural", "feels native", "idiomatic Estonian", "voice reference", "tone of voice", "native speaker", "copy review", and any AC that references a specific human by name as the reviewer.

   Reject `[DRAFT]` titles outright in no-human-input mode — a draft spec is not ready for unattended implementation, and `/auto-implement` rejects the same. Keeping these symmetric is non-negotiable: the `wt auto [branchName]` chain passes the issue ID through to `/auto-implement` as an explicit arg, which skips the filter, so a DRAFT surfaced here would still trigger unattended work.

6. **Prioritize surviving candidates**
   - Todo before Backlog
   - Issues that unblock others (large `blocks` array) before leaf issues
   - Higher priority (lower `priority.value`) before lower

7. **Quick codebase scan**
   Read key files mentioned in the issue description to identify:
   - Files to modify
   - Existing patterns to follow
     Only read 2-3 most relevant files, not the entire codebase.

## Output Format

Return up to 3 unblocked candidates, ranked by priority. Keep total output under 600 words.

```
## Top Candidates

### 1. HON-XX - [Title]
**Why:** Unblocks HON-YY, HON-ZZ | [Brief rationale]
**Files:** `file1.ts`, `file2.ts`
**Summary:** [1-2 sentences]

### 2. HON-AA - [Title]
**Why:** [Brief rationale]
**Files:** `file1.ts`, `file2.ts`
**Summary:** [1-2 sentences]

### 3. HON-BB - [Title]
**Why:** [Brief rationale]
**Files:** `file1.ts`, `file2.ts`
**Summary:** [1-2 sentences]

---

## Parallel Commands

Run in separate terminals for parallel implementation:

\`\`\`bash
wt auto [gitBranchName-1]
wt auto [gitBranchName-2]
wt auto [gitBranchName-3]
\`\`\`
```

The "Parallel Commands" section provides ready-to-copy commands using the `gitBranchName` from Linear. Each command creates a worktree and runs autonomous implementation.

If fewer than 3 unblocked issues exist, return only what's available.

## Completion

After outputting candidates, emit exactly **one** completion marker — never both forms.

**If `autoMode` is false:**

```
[next-issue:complete] Found N candidates: HON-XX, HON-AA, HON-BB
```

**If `autoMode` is true:** include `mode=auto` so the caller can see that the stricter filters were applied.

```
[next-issue:complete] mode=auto | Found N candidates: HON-XX, HON-AA, HON-BB
```

If no unblocked issues survive the filters, emit the matching "no candidates" form for the active mode.

**`autoMode` false:**

```
[next-issue:complete] No unblocked issues found
```

**`autoMode` true:**

```
[next-issue:complete] mode=auto | No unblocked issues found
```

## Important

- Return up to 3 candidates to enable parallel worktree sessions
- Do NOT explore the entire codebase - only files directly relevant to each issue
- Keep each candidate summary brief - main agent will do detailed planning
- Prioritize issues that unblock others
- Always include the `gitBranchName` from Linear in the parallel commands
- The `wt auto` command accepts branch names and extracts the issue ID automatically
- **Every returned candidate must have passed step 4's hard filters via a `get_issue` call with `includeRelations: true`.** Never surface a candidate based on `list_issues` output alone — that endpoint hides `relations` and can disagree with the prose "Blocked by" section. If fewer than 3 candidates survive the filters, return only what survives; do not pad the list.
- When the user asks for a refined variation ("find me three without blockers", etc.), re-invoke this skill rather than ad-hoc-delegating to a general-purpose agent — the skill's filters are the reason it exists. For the no-human-input variation, ask the user to re-invoke with the explicit `--auto` flag (e.g. `/next-issue --auto`); **never translate prose like "that don't need input" or "pure code only" into `--auto` yourself.** Auto mode requires the literal `--auto` token in args.
