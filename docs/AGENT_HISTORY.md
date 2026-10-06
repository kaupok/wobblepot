# Agent rule history

`CLAUDE.md` states each rule and the reason for it. The incident that produced the rule lives here, one entry per Linear issue, so it is not loaded into every session. Read this when you want to change or dispute a rule: the entry says what went wrong without it.

Entries are grouped by the `CLAUDE.md` section they belong to.

## Dependencies

- **HON-588, HON-595 — lockfile pins.** HON-588 cleared three advisories by hand. `defu` was fixed by a lockfile dedupe rather than a spec change: `better-auth` still declares the vulnerable range, so `pnpm update` or a regenerated lockfile can silently undo it. `uuid` and the vitest toolchain were cleared by dependency bumps that a downgrade would equally undo. HON-588 rejected `pnpm.overrides` deliberately, because an override hides the underlying spec instead of detecting drift. HON-595 added the CI gates: `pnpm audit --audit-level critical` runs as the last step of the `ci` job, so a registry outage cannot mask other signals, and `pnpm lockfile:check` asserts the resolutions from `scripts/check-lockfile-pins.ts`.

## Styling and typography

- **HON-673, HON-674 — `@shadcn/lint`.** Adopted the six rules as `pnpm lint` errors on `src/**/*.{ts,tsx}`. `no-arbitrary-values` is off for registry primitives file by file, not by directory, so the hand-written primitives in `src/components/ui/` (`confirm-dialog`, `number-input`, `typography`) stay covered and a new one is covered by default.
- **HON-675 — type primitives.** Removed typography and colour `className` overrides on the type primitives: `Body` gained the `paragraph` variant and the `tone` prop, and the primitives' `no-restyle` contracts allow only named text-state classes.
- **HON-778 — margins on type primitives.** Every type primitive's contract denies `m*-*`, negatives included. `Ul` / `Ol` gained `variant="plain"` for lists that must shed their prose margins.

## Database

- **HON-558 — editing an applied migration.** Prisma stores a checksum of each `migration.sql` at apply time. An applied migration was edited, and `prisma migrate dev` then demanded a full database reset. This is the origin of the immutability rule.
- **HON-641, HON-649, HON-671 — enforcement.** HON-641 added the PR check. HON-649 and HON-671 added the check on every push to `main`, which compares the whole tree (`--tree`: each `migration.sql` against the bytes it was first merged with). An edit merged past a red or cancelled PR check therefore turns `main` red and keeps it red on every later push until it is reverted. This is detection only until HON-584 makes the checks required.
- **Allowlist entries.** `scripts/migration-immutability-allowlist.txt` holds two repairs to migrations that had failed to apply (PRs #181 and #356).
- **HON-727 — the PreToolUse hook.** `.claude/hooks/block-destructive.sh` → `block-destructive.mts` exits 2 with a reason on: `prisma migrate reset`; a `*reset*` package script; `db push --force-reset` / `--accept-data-loss`; `DROP TABLE|DATABASE|SCHEMA` / `TRUNCATE` sent to `psql` or `prisma db execute`; any `git push` whose destination is `main`; any force push; and `gh pr merge` without an inline `WOBBLEPOT_ALLOW_MERGE=1` prefix. It matches what would execute, so `grep "migrate reset"` or a commit message mentioning `gh pr merge` passes. Hooks fire under `--dangerously-skip-permissions`, which is why this covers headless workers.

## Testing, Storybook and geometry

- **HON-518 — E2E drift.** Specs referencing removed routes and renamed copy accumulated unnoticed and had to be fixed in one batch. The per-spec `// ROUTES: … · COMPONENTS: …` headers and the "update specs in the same PR" rule came out of it.
- **HON-612, HON-627 — shared-primitive geometry.** HON-612 raised the control height to 44px and desynced 12 route `loading.tsx` skeletons, which PR review, not planning, had to catch. HON-627 added the `/plan-issue` step 7b scan.
- **HON-729 — reviewer checklist.** No CI check can enforce the E2E-drift or geometry rules, so `scripts/pr-review.sh` appends a checklist item for each when the diff touches the relevant paths. Shared layout wrappers have no single path to gate on and are not covered.
- **HON-859, HON-900 — AI eval report.** HON-794 changed the model constants in `src/lib/ai/models.ts` with no benchmark run, and HON-859 had to run it after the fact, before the next production promotion. The eval spends money, so CI cannot run it; HON-904 (from the HON-900 design) made `scripts/pr-review.sh` ask for a committed report when the diff touches `models.ts`, `budgets.ts`, a request builder the eval imports or text it sends, or a committed case.
- **HON-757 — story existence.** `pnpm stories:check` fails CI when a component under `src/components` has no colocated story. It cannot see whether the story is current.
- **HON-446 — focus restore.** Focus restore on modal close is a Radix contract tied to the real trigger at the real callsite, so E2E owns that assertion and Storybook play functions do not make it.

## Focus management

- **HON-803 — empty-slot meal selector.** A Radix `Dialog` opened from controlled state has no `DialogTrigger`, so closing it dropped focus to `<body>`. Fixed with an `onCloseAutoFocus` prop on `MealSelectorModal` and an `aria-disabled` button in `TimelineEmptySlot`.
- **HON-833 — onboarding.** A submit button that is `disabled` while pending loses focus in Chromium. `CreateHouseholdForm` flags the refocus in the error path and focuses the button once loading ends.
- **HON-804, HON-835.** The same two causes, found again in `MealCard` and in the four auth forms.

## Localization

- **HON-700, HON-724, HON-844 — server text in the UI.** Three separate findings of a client rendering `err.message`, which `apiFetch` fills from the route's English `error` field, so Estonian households read English: the imagine and recipe-import clients, the imagine review dialog, and the recipe form. Each was found at its own callsite before the rule was written down. HON-697 and HON-773 are the neighbouring class: English that was hardcoded or never translated.
- **HON-807 — interpolated names.** Accessible names and descriptions that include a day or a meal use separators ("Pick a meal: Saturday Oct 3, breakfast") rather than prepositions, so Estonian needs no declension.

## Git and workflow

- **HON-695 — a mislabelled `[AUTO DRAFT]`.** An issue filed in a human-driven session was given `[AUTO DRAFT]` because related issues carried it. The prefix is chosen by who filed the issue and how, not by its neighbours.
- **HON-852, HON-853, HON-854 — Queued.** HON-854 made `Queued` the only state the orchestrator reads and gave Todo back to humans. HON-852 / HON-853 are the example of splitting a human-only step (Todo) from its unattended part (Queued).
- **Parallel collisions, 2026-09-30.** Ten refined issues were queued at once with three workers running. HON-840 / HON-841 and HON-804 / HON-824 each edit the same files, so each pair was sequenced with `blockedBy`. The queueing rule in `CLAUDE.md` records that practice.
- **HON-902 — a relation added after the move to Queued.** On 2026-10-01 `/refine-backlog HON-900` created HON-902 in Queued at 13:02:29 and added `blockedBy: HON-901` in a later `save_issue` call. The orchestrator picked it up at 13:03:25, in the gap; the worker stopped at the blocker check (HON-901 was In Progress) and exited without commits, and the issue came back labelled `Gated`. It sat invisible to the orchestrator until a human noticed, two hours after HON-901 had merged. HON-909 made the relation part of the call that queues the issue.
- **HON-1053 — a follow-up written as a note.** On 2026-10-05 the HON-1003 plan said "Golden re-record: not in this PR. Filed as a follow-up." Nothing filed it. The worker repeated the step in its hand-off comment, and the `/merge` summary of PR #1130 repeated it a third time under an improvised "Follow-up" heading on the Done issue: three notes, zero issues. The user filed HON-1052 by hand after the merge. HON-963 had the same step and finished it in a second PR (#1057) only because someone remembered. The rule links a follow-up to its parent with `blockedBy` when it needs the parent's change: HON-1052 was Queued, so with `relatedTo` alone, filed at plan time, a worker would have re-recorded the golden before the prompt change was on `main`.
- **`/branch-review` and `/code-review`.** The project skill was renamed to `/branch-review` when Claude Code shipped a built-in `/code-review` (around 2026-05), to avoid the name collision.
- **HON-562 — Better Auth CLI.** `npx @better-auth/cli@latest generate` is deprecated (renamed to `auth`), and neither works here: the CLI loads `src/lib/auth.ts` through jiti, which cannot resolve the `server-only` import it pulls in transitively. HON-562 found the Better Auth 1.7 `Account.issuer` field by diffing `get-tables.mjs` against `prisma/schema.prisma` by hand.

## Writing style

- **2026-10-06, no issue — bare identifiers in chat.** In a long planning session the agent wrote chat lines such as "do HON-1056, HON-1081 and HON-1080" and "PR #1151 is open". The user said they do not know what an issue is from its number, and asked for a rule. The identifiers were correct and the messages were still unreadable, because only the agent had the titles in context.

## Writing for agents

- **HON-617 — tables nested in list items.** Verified by round-trip on 2026-09-07 through both the MCP `save_issue` tool and the raw GraphQL API, so this is Linear's API rather than the MCP layer. A table only nests if it is indented at or past the item's content indent; once it does, the strip width is that content indent no matter how far it was indented (4 spaces under `1.` still loses exactly 3). A table indented 2 spaces under `1. ` is silently lifted out of the list but keeps its cells. Top-level tables and tables inside a blockquote survive. Comment bodies (`save_comment`) are not affected. Shape-by-shape results are on the issue.

## Working style

- **HON-573 — headless workers and background work.** In the orchestrator's headless spawn (`wt auto` → `claude "$prompt"`, no TTY) the process exits when the turn ends. Workers that backgrounded their CI wait left PRs #650 and #651 open and unmerged while the orchestrator logged SUCCESS.
- **HON-529 — a "just in case" wake-up.** A `ScheduleWakeup` set as a fallback re-fired `/auto-implement 529` about 9 minutes after the PR had already merged, and the skill ran again on stale state.
