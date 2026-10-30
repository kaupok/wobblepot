---
name: implement-issue
description: Implement a Linear issue on its branch from the plan posted to Linear. The default for 'implement HON-X'; it stops after implementation and does not open a PR or merge.
argument-hint: 'HON-XX [--no-plan]'
context: inherit
---

# Implement issue

`/implement-issue HON-XX [--no-plan]`. Done means: the issue's acceptance criteria hold on its branch, with tests, and every item under [Definition of done](#definition-of-done) is true. The skill ends on the completion marker; it opens no PR and merges nothing. `/create-pr` and `/auto-implement` read its output, so the marker, the `Follow-ups:` line and the `Driven:` lines keep their exact shape.

This file states the goal, the gates and the context you cannot derive. How to reach the goal is yours: read the plan, read the code, and adapt when the repo does not match the plan. When the plan turns out wrong, say so and suggest the change; do not follow it into a wall.

## Gates, before any file changes

1. **Fetch the issue** with `mcp__linear-server__get_issue({ id: "HON-XX", includeRelations: true })`. Stop, and do not claim it, when either holds:
   - `statusType` is `completed`, `canceled`, `duplicate` or `triage` (match the type, not the display name). Say which, and point at `/next-issue`.
   - `relations.blockedBy` holds an issue whose status is not Done or Canceled. Entries carry only `{ id, title }`, so re-fetch each with `includeRelations: true`. List the open blockers. A `Duplicate` blocker never clears on its own: name its `duplicateOf` successor, or say the stale relation needs re-pointing in Linear.

   Why: claiming a closed or blocked issue puts it back In Progress and hides the real dependency from `/next-issue`.

2. **Find the plan.** It is the issue comment that starts with `# Plan:`, posted by `/plan-issue`. Check that its issue ID is this one. With no plan, offer `/plan-issue HON-XX` or `--no-plan`. With `--no-plan`, the issue description is the plan; the gate in 1 still runs.

3. **Claim it.** One `save_issue` call sets `state: "In Progress"` and `assignee: "me"`. When the issue is assigned to someone else, ask before reassigning. Do not touch the status again after this: Linear automation moves it once a PR exists.

4. **Be on the issue's branch.** In a worktree, the worktree's branch is the branch. In the main checkout, call `EnterWorktree` with `name: "hon-NN"` (the issue ID in lower case): the `WorktreeCreate` hook resolves it to the issue's branch, and the main checkout is shared with other sessions, so `guard-main-checkout` blocks a switch there. Only with `WOBBLEPOT_ALLOW_MAIN_CHECKOUT=1` switch in place, to Linear's `gitBranchName`.

CLAUDE.md is already loaded; do not re-read it. Read `docs/TYPOGRAPHY.md` only for typography work.

## Implementing

Tell the user the branch, whether a plan was found, and the plan's steps. Then work the plan. Three things sit outside its step list, so a run that only walks the steps misses them:

- **`## Coupled callsites`** is a sibling section of `## Implementation Steps`. Every entry bucketed **Mirror** is edited in this phase. `/plan-issue` step 7b found callsites that hardcode a copy of the geometry you are changing; leaving them for review is the failure that scan exists to prevent.
- **A follow-up is an issue.** A step this issue needs but the PR cannot ship (a golden re-record after a prompt change, a backfill after a migration) becomes a Linear issue before this skill ends, with the `save_issue` call in `/plan-issue` step 10: Queued or Todo, `blockedBy: ["HON-XX"]` when it needs this change on `main`, `addLabels: ["Follow-up"]`, first description line `Follow-up to HON-XX, filed by /implement-issue.`, no title prefix. A plan line still marked `to file:` is filed here too. Why: nobody reads a Done issue again, so a follow-up written only into the plan, a commit message or the summary is lost.
- **Stories.** A change under `src/components/**` updates the colocated `.stories.tsx` (`.claude/rules/ui.md` → Storybook).

## Definition of done

Confirm each before the marker:

- `pnpm lint && pnpm type-check && pnpm test` pass.
- **E2E drift:** a touched `src/app/**/page.tsx`, route URL, navigation or CTA copy, or a modal is covered by the specs' `// ROUTES: … · COMPONENTS: …` headers: `grep -l "ROUTES.*<route>\|COMPONENTS.*<Component>" tests/e2e/*.spec.ts`, and for a copy rename `grep -rn "<exact old copy>" tests/e2e/`. Update what matches.
- **Storybook:** when the diff touches `src/components/**`, stories updated and `pnpm test-storybook:ci` green.
- **Coupled callsites:** when the diff changes a geometry default on a `src/components/ui/*.tsx` primitive, a `@theme` token or a shared layout wrapper, every **Mirror** is edited. Key this off the diff, not the plan, so it holds under `--no-plan` and for plans written before that section existed.
- **Follow-ups:** every step the PR does not ship has an issue ID.
- **Driven screens:** each changed screen was driven in a browser, below.

#### Drive changed screens

Storybook and the E2E grep are static, so a layout break, a wrong empty state or a dead button passes both and is first seen on staging (HON-1188). Drive after the checks above pass, so the screen you drive is the one you ship.

**Trigger:** the branch's changes, uncommitted ones included, list a `.tsx` under `src/app/` (outside `src/app/api/` and `src/app/admin/`) or under `src/components/` (outside `src/components/ui/`), not counting `.stories.tsx` and `.test.tsx`. A `ui/` primitive is covered by its stories. Admin pages open only for `ADMIN_EMAIL`, which the review account is not; do not change the admin gate to reach them. `scripts/pr-review.sh` uses the same trigger. Read the list from the merge base plus untracked files, because this runs before the commit:

```bash
{ git diff --name-only "$(git merge-base origin/main HEAD)"; git ls-files --others --exclude-standard; } | sort -u
```

**Server.** `scripts/review-serve.sh` runs the review server for one issue; its header comment holds the mechanics (database mode, port, pid file). It is `scripts/e2e-local.sh serve`, not `pnpm dev`, because only the review server turns on `/api/e2e-seed`, which sign-up needs.

```bash
bash scripts/review-serve.sh start HON-XX          # run_in_background: true, timeout: 3600000; add --seed when the screen needs seed data
bash scripts/review-serve.sh wait HON-XX           # foreground, timeout: 540000, in the same turn (CLAUDE.md → Waiting inside a skill)
```

`wait` prints `REVIEW-READY <url>`, or `REVIEW_WAITING` (run it again), or `REVIEW_FAILED` with the log tail. On `REVIEW_FAILED` (no Neon slot, no Neon key, a refused `.env`), do not block the PR: write a "Not verified" line with the reason and skip to the stop step.

**Browser.** Pick one by `docs/BROWSER_TESTING.md` → Which browser: the T3 Code sidebar (`preview_*`) first, then the Playwright MCP (`browser_*`); its Tool mapping pairs the names. Not the Chrome extension, because it cannot save the screenshot file this step uploads. With neither loaded (a worker without the Playwright MCP, `docs/PARALLEL_WORKFLOW.md` → Untracked Files), write a "Not verified" line that says so and skip to the stop step.

**Account.** Sign up a review account (`docs/BROWSER_TESTING.md` → Walking the flow): `curl -X POST <url>/api/e2e-seed` returns `{"code":…}`; sign up on `<url>/sign-up` with it, `review-<timestamp>@example.com` and `TEST_PASSWORD` from `tests/e2e/utils/test-helpers.ts`, then finish onboarding. Never a real address or password. The sidebar keeps cookies between runs and `localhost` cookies are shared across ports, so `/sign-up` can redirect to `/` or `/onboarding` as a dev or old review session; then sign out from the user menu and load `/sign-up` again. The Playwright MCP starts with no cookies.

**Cookie banner.** Before the first screen, click "Essential only" in the "Cookie consent" region once per run (`src/components/CookieBanner.tsx`). The banner covers the bottom of every screen and intercepts clicks there (HON-1205). Not "Accept all": the review server may carry PostHog keys from `.env`, and a review session must not count as a visitor.

**Each screen.** Go to the route, snapshot, do the issue's main action, snapshot again, and check the result against the acceptance criteria. Save a screenshot (`preview_snapshot` with `save: true` returns `screenshotPath`; `browser_take_screenshot` with `filename: "hon-XX-<screen>.png"` reports its path). A defect found here is fixed now and driven again.

**Upload** each screenshot to the Linear issue, one file at a time: `prepare_attachment_upload` (`issue`, `filename` `hon-XX-<screen>.png`, `contentType: "image/png"`, `size` from `wc -c < <path>`), then `curl -X PUT --data-binary @<path>` to `uploadRequest.url` with every header in `uploadRequest.headers` sent verbatim, within 60 seconds, then `create_attachment_from_upload` with the `assetUrl`. A failed upload keeps the `Driven:` line; say "screenshot not uploaded" on it. The PR body links the attachment by name, because `gh` cannot upload an image.

**Stop:** `bash scripts/review-serve.sh stop HON-XX` (in branch mode this also deletes the Neon branch), and close the tab (`t3_preview_close` / `browser_close`).

**Evidence:** one line per screen, for the PR body's "Verified" list, naming the route, the action, what the snapshot showed and the Linear attachment. `scripts/pr-review.sh` reports a PR that matches the trigger and has no such line, unless "Not verified" says why.

```
- Driven: `/shopping-list` — ticked "Milk"; the item moved to Done and the counter read 3/4. Screenshot `hon-XX-shopping-list.png` on HON-XX.
```

## Completion

Print the marker exactly; `/auto-implement`, the orchestrator and `worktree-claude.sh` match on it:

```
[implement-issue:complete] Implementation complete for HON-XX
```

Then, each on its own line, so `/create-pr` can put them in the PR body: `Follow-ups: HON-AA (Queued, blocked by HON-XX), HON-BB (Todo)` when there are any, and every `Driven:` line.
