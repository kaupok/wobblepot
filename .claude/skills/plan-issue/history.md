# Plan Issue — the incidents behind the rules

Read before changing or disputing a rule in `SKILL.md`. Nothing here is needed to plan an issue.

Each section is keyed by the step it explains. HON-1235 moved the incident references and "why this is here" paragraphs out of `SKILL.md` into this file, so the procedure carries the action, the command and the check, and this file carries the reason.

## Sibling overlap check (step 3)

When an issue is part of an epic (has `parentId`) or has `relatedTo` links, a sibling issue may have already landed and introduced files, conventions, schema, or constants that your plan needs to build on rather than duplicate. Step 2 checks `blockedBy`; `relatedTo` and epic siblings are not blockers, but a Done sibling in the same epic is a strong "check for overlap" signal.

The merged PR is looked up by the sibling's `gitBranchName`, because PR titles are Conventional Commits and carry no issue ID, so a title search finds nothing. The body search is the fallback for a renamed branch.

The finding is reported inline before planning continues, so the user can redirect if the overlap changes scope.

## Read the sibling's diff (step 6)

The file tree alone does not tell you which lines a sibling added. Without the diff you risk searching for a pattern, not finding it, and duplicating it.

## Unlinked recent changes (step 6; HON-1240)

The sibling check sees only issues linked to this one. HON-1226 (PR #1267) moved the landing cost line out of the hero, but only HON-1116 linked it, not HON-1057. A dry run of this skill on HON-1057 missed it, so the plan kept the issue's stale placement ("under the cost line in the hero") and a test that no longer matched main. A recent commit to a file the issue names is the signal the links miss, because the issue's text was written against the file before that commit.

## E2E impact (step 7a; HON-518)

When a plan touches a route, renames user-visible copy, or restructures a modal or dialog, one or more `tests/e2e/*.spec.ts` files are almost always affected. Before HON-518 these updates lagged the UI change by months and surfaced as an unrecoverable batch when CI came back online. Catching the impact at planning time is the cheapest place to fix it: the plan lists the specs, and the implementation ships UI and spec updates in one PR.

The scan runs after codebase exploration (step 6) so the file set is real, not a mental sketch.

Both step 7 scans (7a and 7b) are cheap greps, and both are cheaper at planning time than in review.

## Shared-primitive coupling (step 7b; HON-612, HON-627)

Changing a shared primitive's geometry breaks everything that hardcoded a copy of it, and those copies are invisible from the primitive's own file. HON-612 (PR #704) raised `Button` / `Input` / `Select` to 44px on mobile and silently desynced 12 route `loading.tsx` skeletons that had been sized to mirror the old 36px controls. The issue's own step list named 9 composites to sweep and none of the skeletons, so review caught it instead. HON-627 added the 7b scan.

The greps stay a net, not a proof: a missed callsite costs a review comment, an unreadable scan costs the whole step.

A clean scan names the property it scanned (`none — no callsite hardcodes the changed height`), not the unqualified "geometry", so a change that moved height and padding but was only scanned for height cannot read as a clean full scan.

The bucket is not readable off the class name. HON-612 changed 12 of the 15 skeleton files that then existed by opening the component each one stood in for. Of the three it left alone, one (`meal-plan/loading.tsx`) was not a list row at all but dead weight on a bare-redirect route, deleted since in HON-629.

## Follow-ups hold issue IDs (step 8; HON-1053)

"Filed as a follow-up" with no ID is the HON-1053 defect: nothing files it later, because nobody reads a Done issue again.

## Filing a follow-up (step 10; HON-902)

`blockedBy` goes in the same `save_issue` call that files the follow-up. The orchestrator picks up a Queued issue within a minute, so without the relation a worker ran the step before the parent's change was on `main` (HON-902).

The run-state labels `Gated`, `Stranded` and `Needs attention` describe the parent's run, not the follow-up. The orchestrator skips a Queued issue that carries `Gated` or `Stranded`, so a follow-up that copied them would never run.

## Tables at top level (step 10; HON-617)

Linear does not strip anything from a comment body, so the posted plan is not itself at risk. Plan content gets copied by hand into issue descriptions, though, where Linear strips the enclosing list item's content indent off every table body cell (CLAUDE.md → Writing for Agents). Keeping every plan table at top level keeps the copy safe.

## No claim on a blocked issue (step 11; HON-1240)

Step 2 asks the user before planning a blocked issue, but under `--auto` nobody answers, and step 11 once claimed the issue anyway. HON-1057 is blocked by HON-1076 (its quote text does not exist yet), so a claim would show it as taken while nobody can work on it. The plan still posts, because it is useful once the blocker closes. `/auto-implement` 2.1 gates blockers before its own claim, so the two skills agree.
