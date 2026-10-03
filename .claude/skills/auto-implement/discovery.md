# Auto-implement — Phase 1: auto-discovery

Read from `SKILL.md` → Phase 1 when no issue ID was passed. Run 1.1–1.7 in order, then return to `SKILL.md` → Phase 2.

```
[auto-implement] Phase 1/7: Finding next unblocked issue
```

### 1.1 Read project context

```
Read docs/PROJECT_SPEC.md
```

Review for current phase and relevant context.

### 1.2 List unassigned Queued issues

List **`Queued` only**. Queued is the unattended queue: an issue lands there only when a human has decided an agent can finish it alone. Todo means a human intends to do the work, and Backlog is unrefined or unprioritised, so neither is ever listed here — `/next-issue` is where Backlog and Todo candidates get surfaced to a human (HON-854).

Always pass `assignee: "null"` — In Progress / In Review / Done / Canceled issues are already claimed or complete and must never be picked up by an autonomous cycle, and an assigned Queued issue has been taken by a human.

```
mcp__linear-server__list_issues({ state: "Queued", assignee: "null", limit: 100 })
```

### 1.3 MANDATORY: Verify every candidate with `includeRelations: true`

`list_issues` does NOT return relations. Before a candidate can enter the selection pool, re-fetch it:

```
mcp__linear-server__get_issue({ id: "HON-XX", includeRelations: true })
```

### 1.4 Hard filters — reject the candidate if ANY of these fail

- `status` is `Queued` — reject `Backlog`, `Todo`, `In Progress`, `In Review`, `Done`, `Canceled`, `Triage`.
- `assignee` is `null` — reject any assigned issue, including "me".
- Every id in `relations.blockedBy` resolves to `status` ∈ { `Done`, `Canceled` }. Empty `blockedBy` passes. Any open blocker (Backlog / Todo / Queued / In Progress / In Review) fails.
- `statusType` is not `triage` or `canceled`.

If a candidate fails any filter, discard and pick another. Do not soften or bypass a filter to keep a candidate. An autonomous cycle that picks a claimed or blocked issue will collide with other work or stall at implementation — both are worse than having no issue to pick.

### 1.5 No-human-input filters — default in auto-discovery

**Only applies when auto-discovering (no issue ID was passed as argument).** When the user passes an explicit `HON-XX`, skip this step — they've made the judgment call and Phase 1 is already short-circuited.

`/auto-implement` runs end-to-end unattended, so an auto-discovered issue must be completable without human input. Moving an issue to Queued already asserts that, so these filters are a second line of defence against a mis-queued issue, not the primary gate — keep them. Reject the candidate if the description or acceptance criteria imply any of:

- Third-party account provisioning (Upstash, PostHog, Sentry, Resend, Chromatic, Anthropic console, etc.)
- New environment variables / secrets on Vercel or elsewhere
- DNS changes (SPF/DKIM/DMARC, subdomain setup, registrar actions)
- Legal / copy review (privacy policy text, ToS, company entity details, parental consent wording)
- Design assets (OG images, branded graphics, mockups)
- Ops access (authenticated CLI like `neonctl` against production, Vercel dashboard edits, GitHub org settings)
- Shared-state side effects (staging DB writes that can't be reset, sending real emails, outbound API calls that cost money)
- Subjective human review — the acceptance criteria require a human to *validate quality*, not just to provide inputs. An agent can produce the artifact but cannot close the ticket. Covers: native-speaker / native-judgment work (voice, tone, register, idiom), copy or naming quality review, design polish review, and any AC that name-drops a specific reviewer ("does Kaupo read this and…"). Distinct from "legal / copy review" — that's about *clearance*; this is about *taste*.

Skim for red-flag phrases: "add env var", "add secret", "configure DNS", "sign up", "provision", "API key", "`support@`", "legal entity", "OÜ", "Resend", "Upstash", "PostHog", "Sentry", "Anthropic console", "Vercel dashboard", "manual spot-check", "reads natural", "feels native", "idiomatic Estonian", "voice reference", "tone of voice", "native speaker", "copy review", and any AC that references a specific human by name as the reviewer.

Also reject `[DRAFT]` and `[AUTO DRAFT]` titles in auto-discovery. A draft spec is not ready to implement unattended, and an `[AUTO DRAFT]` is a finding this skill filed itself in 6.8 — picking one up would let the cycle generate its own work and implement it with no human ever in the loop. A human clears the prefix via `/refine-backlog --auto-drafts`; until then it stays out of auto-discovery. An explicit `HON-XX` argument still overrides this, per the top of 1.5.

If all candidates fail, exit normally per step 1.7 ("No unblocked issues found"). Do not soften the filter to find a match — a stalled half-PR is worse than no work.

### 1.6 Prioritize surviving candidates

- Issues that unblock others (larger `blocks` array) before leaf issues
- Higher priority (lower `priority.value`) before lower

### 1.7 Select issue

If no unblocked issues found:

```
[auto-implement] ✓ No unblocked issues found. Nothing to implement.
```

Stop here (normal exit).

Otherwise, store the issue ID:

```
[auto-implement] ✓ Selected: HON-XX - [Title]
[auto-implement] Phase 1/7 complete → Proceeding to Phase 2
```
