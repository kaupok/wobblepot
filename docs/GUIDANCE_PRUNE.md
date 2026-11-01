# Guidance prune

A new model generation makes some steering rules dead weight: the model does what the rule asks without it. Each rule costs every reader context and a constraint on judgment, and nothing removes a rule once it is added. This file holds the inputs for the prune that follows a model swap: the groups, the evidence each group needs before a cut, and the three inventory prompts. The checklist that runs them is [PARALLEL_WORKFLOW.md → Prune the guidance](PARALLEL_WORKFLOW.md#prune-the-guidance). The first prune (HON-1525, 2026-10-30) produced the inventory document on that issue.

## Method

- Dates come from `docs/AGENT_HISTORY.md`, the skill `history.md` files, or `git log -S` on the rule's own phrase.
- Models come from the `"model"` field of the session transcript that holds the incident, or from the `Co-Authored-By` trailer of the commit that added the rule. Write "model unknown" where neither exists. Entries in `docs/AGENT_HISTORY.md` name the model from 2026-11-01 on.
- A model timeline in each prompt maps a date to the models that ran then. Build it from `git log -p -- scripts/models.sh` for the workers and the reviewer, and from the transcripts' `"model"` fields for interactive sessions.
- "reviewer X_PROMPT" means a checklist item in `scripts/pr-review.sh` that runs on every PR.
- "TEST-LOCKED" means a `scripts/*.test.ts` asserts the exact wording. Deleting that prose turns the test red.
- Line numbers are as of `main` on the day of the inventory.

## Groups

- **Keep**: the rule protects data, money, production, security or legal compliance; or it states a project convention the model cannot infer; or it covers a failure of the environment that a stronger model does not fix (a headless exit, an orchestrator race). A rule with an incident on a current model is Keep.
- **Mechanical**: a hook, lint rule, test or CI check enforces it, so the prose can shrink to a pointer.
- **Harness**: the Claude Code system prompt states the same.
- **Candidate**: the incident came from an older model's weakness; or there is no incident and the rule states default behaviour; or the rule was imported from someone else's skill with no incident of ours.
- **Unknown**: none of the above can be shown.

A row under about 15 words is not worth the churn: skip it.

## Evidence before a cut

A cut needs evidence that the rule is not needed. A shrug is not evidence.

| Group                                                 | Evidence before cutting                                                                                                                      | Eval run? |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Harness                                               | A `claude -p` dry run in which the worker quotes the harness line, plus an AGENT_HISTORY entry with the sentence and the Claude Code version | No        |
| Duplicate of another file                             | Name the canonical copy that stays. The rule still reaches the model                                                                         | No        |
| Mechanical                                            | Run the check on a known-bad input and quote the error. The error names the fix                                                              | No        |
| Candidate with a mechanical check                     | Blind eval (`scripts/steering-eval.sh`, [STEERING_EVAL.md](STEERING_EVAL.md)) on every reader, control arm first                             | Yes       |
| Candidate with no mechanical check, or under 15 words | No evidence, so the rule stays and is listed as untested                                                                                     | No        |

A deletion must pass on every reader: `AUTO_MODEL`, `AUTO_MODEL_SMALL` at `AUTO_EFFORT_SMALL`, and `INTERACTIVE_MODEL` (`scripts/models.sh`).

## The three inventory prompts

Run each as a read-only Explore agent, thoroughness "very thorough", files read in full. Replace the model timeline with the current one (Method).

### Prompt 1: CLAUDE.md, rules, hooks and scripts

Read `CLAUDE.md`, `.claude/rules/*.md`, `docs/AGENT_HISTORY.md`, `.claude/hooks/*`, `.claude/settings.json`, every `scripts/check-*.ts|sh`, `scripts/*-hook.test.ts`, `scripts/auto-implement-*.test.ts`, `scripts/browser-review-docs.test.ts`, `scripts/design-gate.test.ts`, `scripts/review-checklist-gate*.ts`, `scripts/pr-review.sh`, the allowlists, and `eslint.config.mjs`. Date an undated rule with `git log -S'<phrase>' --reverse --format='%ad %h %s' --date=short -- CLAUDE.md .claude/rules`. For a candidate, find the incident's session with `grep -l 'HON-NNN' ~/.claude/projects/*wobblepot*/*.jsonl` and read its `"model"` field. Output: (1) one table, one row per rule: file and section, rule in 15 words, words of prose, incident, date, model, enforcing check, group, reason; (2) a table of each hook or script → the rule it enforces → whether a test pins prose; (3) words per group; (4) the five strongest deletion or shrink candidates with evidence.

### Prompt 2: the delivery-cycle skills

Read `.claude/skills/auto-implement/` (SKILL.md and every sibling), `.claude/skills/plan-issue/` (SKILL.md, history.md, ai-eval.md), and the SKILL.md of implement-issue, merge, ship, branch-review, create-pr, commit, review-pr, triage-pr-comments; also `docs/AGENT_HISTORY.md`. A rule is a behavioural instruction that stops an agent mistake, not a plain procedure step. Groups as in prompt 1, plus: a failure of the environment (headless exit, an orchestrator race) is Keep. Note every `scripts/*.test.ts` that asserts skill prose. Output: a table per skill; per skill the word count, how often it loads and the candidate words; the five strongest candidates; every rule two or more skills repeat.

### Prompt 3: the planning and audit skills

Read the SKILL.md of next-issue, refine-backlog, ideate, browser-review, break-ui, diagnose, retro, gtm, tech-audit, audit-ingredients, bench-judge, judge (SKILL.md and every sibling); `docs/AGENT_HISTORY.md`; `docs/TRIAGE_RUBRIC.md`. Same rule definition and groups as prompt 2, plus: a rule imported from someone else's skill with no incident of ours is a Candidate. Count invocations in the last 30 days from the transcripts. Output: as prompt 2, plus whole skills that look unused.

Each prompt names the skills that existed on 2026-11-01. Add any skill created since to the prompt whose group it joins.
