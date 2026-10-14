---
name: diagnose
description: Debug a reported bug with a feedback loop first. Build one command that goes red on the exact symptom, then minimise, rank hypotheses, instrument, fix with a regression test, and clean up. Use when the user says debug or diagnose, or reports something broken, failing or slow.
argument-hint: '<bug description or HON-NNN>'
context: inherit
---

# Diagnose

Find the cause of a bug, fix it, and prove the fix. The method comes from Matt Pocock's `diagnosing-bugs` skill, adapted to this repository's commands.

**Do not form a hypothesis before the feedback loop exists.** A theory without a red command is a guess, and a fix for a guess cannot be proved.

## Input

The argument is a bug description or a Linear issue ID.

- `HON-NNN` → fetch it with `mcp__linear-server__get_issue({ id, includeRelations: true })` and read its comments. The symptom is what the issue says the user saw.
- Free text → that text is the symptom. If it names no observable behaviour ("it's broken"), ask the user once for what they saw and where.

Write the symptom down in one sentence before Phase 1. Every later phase checks against that sentence.

## Phases

Run the phases in order. Do not start a phase until the previous one is done.

### 1. Redact

Replace every secret with `<REDACTED>` in each command, output and artifact you show: API keys, tokens, cookies, session IDs, database URLs, passwords, and the user's personal data. A loop reads credentials from env vars (`$DATABASE_URL`, `$NEON_API_KEY`), never from a literal in the command.

This applies to every later phase, so the rule holds until the skill ends.

**Done when** the commands you plan to run read credentials only from env vars, and no output you have shown holds a secret.

### 2. Build a feedback loop

Build one command that goes red on the user's exact symptom and green once it is fixed. It must be deterministic, fast (seconds, not minutes) and runnable by you without a human. Try the options in this order, because each one is slower or less exact than the one above it:

1. **A failing Vitest test next to the source.** `pnpm test <path>`. A `.test.ts` file runs in node and a `.test.tsx` file runs in jsdom; a `.test.ts` that needs a DOM starts with `// @vitest-environment jsdom` (CLAUDE.md → Testing). Use `createQueryWrapper()` from `src/test/query-wrapper.tsx` for a component that uses TanStack Query.
2. **A Storybook play function.** `pnpm test-storybook:ci <path-to-story>`. Use it when the bug lives in rendering or interaction that jsdom does not model (focus, layout, a Radix portal).
3. **A Playwright spec.** `pnpm test:e2e:local tests/e2e/<spec>.spec.ts` runs one spec against a fresh Neon branch. Name one spec: the full suite is slow, and the `@ai` specs make paid Claude calls. If the run outlasts the 600 s Bash cap, use the marker-file wait in `.claude/skills/auto-implement/batched.md`.
4. **A `curl` against the review server.** Start `pnpm review:local` with `run_in_background: true`, wait in the foreground until its output holds `REVIEW-READY http://localhost:<port>`, then `curl` the route. Keep it running for the later phases, which re-run the loop. Stop it in Phase 7, or before you stop at any earlier point, so its Neon branch is deleted. Never end a turn beside it (CLAUDE.md → Working style).
5. **A throwaway script under `/tmp`.** Use it for a pure function or a data shape that has no test seam yet. Never commit it.
6. **`git bisect run` with one of the above,** when the bug appeared between two known commits. The loop command is the bisect script; it must exit non-zero on the bug and zero without it.

**A flaky bug** is not debuggable at a 1-in-50 rate. Raise the reproduction rate first: loop the trigger (`(for i in $(seq 1 50); do pnpm test <path> || exit 1; done)`, which exits non-zero on the first failure), add load, shorten timeouts, or force the interleaving. Debug once the loop goes red most of the time.

**A reproduction only a human can run** (a real device, a payment provider, a third-party login) gets no `hitl-loop` script. Treat it as "If no loop can be built" below. In an unattended run there is no user to ask, so file a Todo issue instead that names the steps and what to capture. When the input was `HON-NNN`, link it with `relatedTo` and add the `Follow-up` label (`/plan-issue` → "A follow-up is an issue").

**Done when** you name one command, you have run it once, you show its redacted output, and that output shows the symptom from your one-sentence description, not a nearby failure. A test that fails on a typo in the test does not count.

**If no loop can be built,** stop any server you started, then stop. List each option you tried and why it did not reproduce the symptom. Ask the user for a reproducing environment or a redacted artifact: a HAR file, a server log, a screen recording. No loop, no hypotheses.

### 3. Minimise

Remove one element at a time: an input field, a caller, a config value, a step in the reproduction. Re-run the loop after each cut. If the loop stays red, the element was not the cause, so leave it out. If the loop goes green, put the element back, because it is load-bearing.

**Done when** removing any one remaining element turns the loop green.

### 4. Hypothesise

List 3 to 5 hypotheses before you test any of them. Rank them by likelihood. Write each one so it can be proved false:

> If `<X>` is the cause, then changing `<Y>` makes the bug disappear.

A hypothesis with no such test ("something with caching") is not on the list until it has one. Show the list to the user and continue; do not wait for an answer. The user may know which one is right, but the loop decides.

**Done when** the list has 3 to 5 ranked entries, each with a change that would falsify it, and the user has seen it.

### 5. Instrument

Test the hypotheses in rank order. Add one probe per prediction and change one variable at a time, so each run answers one question. Tag every debug log with one unique prefix for this session, such as `[DEBUG-a4f2]`, so Phase 7 can find every probe with one grep.

For a performance bug, measure a baseline before any change, and record it. Then bisect the slow path (halve the work, time each half) until one step holds the cost.

**Done when** one hypothesis survives its test, the others are each falsified by a recorded run, and you can state the cause in one sentence. If every hypothesis is falsified, go back to Phase 4 with what the probes showed.

### 6. Fix and regression test

1. **Write the regression test before the fix.** Put it at a seam that exercises the real bug pattern, not a mock of the internal function you are about to change. The Phase 2 loop is often this test already. A test must be able to fail (CLAUDE.md → Testing).
2. **Watch it fail** on the unfixed code, with the symptom.
3. **Apply the fix.**
4. **Watch it pass.**
5. **Re-run the Phase 2 loop** on the original scenario, if the regression test is not the same command.

If no seam exercises the real bug pattern, say so in the PR body. That is a finding about the code: it says where a test seam is missing.

**Done when** the regression test was red before the fix and green after it, and the Phase 2 loop is green.

### 7. Clean up

1. Grep the debug prefix across the repository (`git grep -n --untracked "DEBUG-a4f2"`, which skips ignored build output such as `.next/`) and remove every hit.
2. Delete the throwaway scripts under `/tmp` and stop any server you started.
3. State the confirmed hypothesis in the commit message body, and in the PR body under "Verified" next to the regression test that proves it. The next reader then learns the cause, not only the fix.

**Done when** the grep for the debug prefix returns nothing, no server from this session is running, and the commit message names the cause.
