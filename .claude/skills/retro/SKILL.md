---
name: retro
description: Look back over a session and propose changes to the environment (checks, reviewer rules, docs pointers, steering) that would have caught or prevented what went wrong, most severe first. Applies only what the user approves.
argument-hint: '[session description or HON-NNN]'
disable-model-invocation: true
context: inherit
---

# Retro

Review a session and propose changes to the environment, not to the code the session wrote. The method comes from Matt Pocock's `retro` skill, adapted to this repository's checks and docs.

The question for every candidate: **what change to this repository would have caught it, or made it unnecessary, for the next agent?**

## Rules

- **Prefer a check over a rule.** A mechanical mistake gets a check. Only a judgement call goes into prose. A check can live in three places:
  - the ESLint config (`eslint.config.mjs`), for a pattern in source code;
  - a `scripts/*.test.ts` test (`scripts/check-*.ts` with its test, or a gate test such as `scripts/review-checklist-gate.test.ts`), for a repository-wide rule that `pnpm test` runs;
  - a CI workflow step (`.github/workflows/*.yml`), for a rule that needs the PR, a build or a database.
- **CLAUDE.md is loaded every session, so a new line there must earn its place.** Put reference material in a `docs/*.md` file, with one pointer from CLAUDE.md. Put a rule that only one skill needs in that skill.
- **Do not use the Claude Code auto-memory directory** (`~/.claude/projects/*/memory/`). See CLAUDE.md → Agent memory.
- **Writing** follows CLAUDE.md → Writing style and Writing for Agents. Issue descriptions state the why, the files, and testable acceptance criteria.

## Input

The argument is optional.

- **No argument** → the session record is the current conversation.
- **Free text** → the current conversation, with the text as the focus ("the CI wait", "the review rounds"). Look at the rest of the conversation too, but rank candidates from the focus first.
- **`HON-NNN`** → the session record is the issue and its PR:
  1. `mcp__linear-server__get_issue({ id, includeRelations: true })` and `mcp__linear-server__list_comments({ issueId })`. The comments hold the plan, any hand-off and the merge summary.
  2. `gh pr list --head "<gitBranchName>" --state all --json number,title,state,url`, with `gitBranchName` from the `get_issue` result. PR titles carry no issue ID, so an `in:title` search finds nothing. If the list is empty, try `gh pr list --search "HON-NNN in:body" --state all --json number,title,state,url` and keep only PRs whose body says `Closes HON-NNN`. If both are empty, say that no PR was found before you continue. For each PR: `gh pr view <n> --json body,commits,reviews` and the comments below. Use `--paginate` with `jq -s 'add'`, because `--jq` runs once per page (HON-586).
     ```bash
     gh api --paginate '/repos/:owner/:repo/pulls/<n>/comments?per_page=100' | jq -s 'add'
     gh api --paginate '/repos/:owner/:repo/issues/<n>/comments?per_page=100' | jq -s 'add'
     ```
     The issue comments hold the reviewer summaries (`<!-- claude-review -->`), one per review round, and any `not actioned:` notes.

## Steps

Run the steps in order.

### 1. Read the session record

Collect the events that cost something:

- **Current conversation:** tool calls that errored or were retried, searches that took several attempts, fixes the user asked for, checks that failed (lint, type-check, test, CI), and review rounds.
- **An issue:** the review rounds and their findings, fix commits after the first push (`fix: Address review feedback`), CI failures, a 6.7 hand-off, and labels such as `Gated` or `Stranded`.

**Done when** you have a list of events, each with one line of evidence: a quote, a command, or a comment link.

### 2. Find candidates

Sort each event into one of six categories. An event that fits none is not a candidate: drop it.

Before you propose a new check, read the `package.json` scripts and `.github/workflows/`. A check that exists but is not wired into `pnpm test` or CI is the finding, not a new check.

- **Navigation.** Applies when the agent took many reads or greps to find one thing. Fix: a pointer in CLAUDE.md's Documentation Structure table, a `// ROUTES: … · COMPONENTS: …` style header comment, or a line in the relevant `docs/*.md`.
- **Automated checks.** Applies when the agent made a mistake that a lint rule, a `scripts/check-*.ts` test, a gate test like `scripts/review-checklist-gate.test.ts`, or a CI step could catch. Fix: the check, in one of the three places under Rules.
- **Reviewer rules.** Applies when `scripts/pr-review.sh` missed a finding that a human or a later session caught. Fix: a mechanical pattern gets a check (as above). A judgement call gets a reviewer checklist item in `scripts/pr-review.sh`, with a path gate, and a case in `scripts/review-checklist-gate.test.ts`.
- **Steering no-ops.** Applies when the session did not follow a CLAUDE.md or skill instruction and did not need it. Fix: remove the instruction, or move it to `docs/` with a pointer.
- **Tool economy.** Applies when a tool call or MCP call cost many tokens for a small result: `list_issues` without a filter, a full-file read where a grep served, a `get_issue` without `fields`. Fix: a line in the skill or doc that sent the agent there.
- **Information access.** Applies when the agent needed a fact and could not reach it: a log, a staging state, a vendor dashboard. Fix: a script, a runbook line in `docs/RUNBOOKS/`, or an MCP server named in `docs/MCP_SETUP.md`.

Check `docs/AGENT_HISTORY.md` for each candidate. When a rule for it exists and the session broke it anyway, the candidate is a check that enforces the rule, not a second rule.

**Done when** each candidate has a category and one proposed change.

### 3. Present candidates, most severe first

Rank by what the event cost, then by how often it can recur:

1. **Shipped or would ship a defect:** a bug, a security gap, data loss, a stranded PR.
2. **Cost a review round, a CI run, or a retry.**
3. **Cost tokens or time only.**

Show one block per candidate:

```
1. <short title>
   Evidence: <one line from the session record>
   Category: <one of the six>
   Change: <what to add, remove or move>
   Where: <CLAUDE.md | docs/<file>.md | .claude/skills/<name>/SKILL.md | scripts/<file> | eslint.config.mjs | .github/workflows/<file>.yml>
```

If nothing qualifies, say so in one line and stop. Do not pad the list.

**Done when** the user has seen the ranked list.

### 4. Apply what the user approves

Ask which candidates to apply. Then, for each approved one:

- **Default: file a Linear issue** in the `Wobblebot` team, state `Backlog`, label `Improvement`. Put the evidence in the description, as the why. Write plain `HON-NNN` references, and set `relatedTo` to the session's issue when there is one.
- **Edit directly** only when the change is one line in a doc or a skill and the user says to make it now. Make the edit in a worktree (CLAUDE.md → Git & Workflow Essentials).
- **A new rule in CLAUDE.md always gets a `docs/AGENT_HISTORY.md` entry**, under the matching section, that names the incident. The issue says so in its acceptance criteria.

**Done when** every approved candidate has an issue ID or a committed edit, and you have listed them for the user.
