---
name: implement-issue
description: Implement a Linear issue on its branch from the plan posted to Linear. The default for 'implement HON-X'; it stops after implementation and does not open a PR or merge.
argument-hint: 'HON-XX [--no-plan]'
context: inherit
---

# Implement Issue

Execute an approved implementation plan and begin coding.

## Prerequisites

Requires an issue ID as argument (e.g., `/implement-issue HON-51`).

Supports optional `--no-plan` flag to skip plan validation for simple issues.

## Workflow

### 1. Parse arguments

Extract issue ID and check for flags:

- Issue ID: `HON-XX` or just `XX` (required)
- `--no-plan`: Skip plan lookup and validation (steps 4-5)

If no issue ID provided:

```
Usage: /implement-issue HON-XX [--no-plan]
Examples:
  /implement-issue HON-51          # Normal flow with plan
  /implement-issue HON-51 --no-plan  # Skip planning for simple issues
```

### 2. Handle --no-plan mode

If `--no-plan` flag is present:

- Still run step 3 — the fetch supplies `gitBranchName` and the status/blocker gate
- Skip steps 4-5 (plan lookup and validation)
- Use issue description as implementation guide
- Continue from step 6 (status update)

### 3. Fetch issue details

```
mcp__linear-server__get_issue({ id: "HON-XX", includeRelations: true })
```

Extract:

- Issue UUID (for API calls)
- `gitBranchName`
- Current state
- Current assignee
- `relations.blockedBy`

**Hard gate (runs in both normal and `--no-plan` mode) — stop before claiming the issue if either holds:**

- `statusType` is `completed`, `canceled`, `duplicate`, or `triage` (Done / Canceled / Duplicate / Triage — match on `statusType`, not the display name, same as `/auto-implement` 2.1) — the issue is closed or not yet refined:

  ```
  HON-XX is [status] — nothing to implement. Pick another issue (`/next-issue`) or reopen it in Linear first.
  ```

- `relations.blockedBy` contains any issue whose status is not `Done` or `Canceled` — entries carry only `{ id, title }`, so re-fetch each one with `mcp__linear-server__get_issue({ id, includeRelations: true })` to read its status (and `relations.duplicateOf`, which is absent without `includeRelations`) — list the open blockers and stop:

  ```
  HON-XX is blocked by open issues:
    - HON-YY ([status]) — [title]
    - HON-ZZ ([status]) — [title]
  Finish the open blockers first. A blocker with status `Duplicate` never clears on its own: follow its `duplicateOf` successor if set, otherwise re-point or remove the stale relation in Linear.
  ```

Do not proceed to step 4 (or step 6 in `--no-plan` mode) while either condition holds. Claiming a closed or blocked issue would put it back In Progress and hide the real dependency from `/next-issue`.

### 4. Find plan from Linear comments

```
mcp__linear-server__list_comments({ issueId: "issue-uuid" })
```

Look for a comment starting with `# Plan:` - this is the plan posted by `/plan-issue`.

If no plan comment found:

```
No plan found for HON-XX in Linear comments.

Options:
1. Run `/plan-issue HON-XX` to create and post a plan first
2. Run `/implement-issue HON-XX --no-plan` to skip planning
```

### 5. Validate plan

Verify the plan comment:

- Contains implementation steps
- Contains files to create/modify
- Issue ID in plan matches the requested issue

Store the plan content for implementation guidance.

### 6. Update issue status and assign to self

If assigned to someone else, warn the user and ask before reassigning.

If current state is not "In Progress" or the issue is unassigned, claim it in a single call:

```
mcp__linear-server__save_issue({
  id: "HON-XX",
  state: "In Progress",
  assignee: "me"
})
```

### 7. Create or switch to branch

First, detect if we're in a worktree:

```bash
git rev-parse --git-common-dir
git rev-parse --git-dir
```

If outputs differ → **worktree mode**
If outputs same → **regular repo mode**

**Worktree mode:**

In a worktree, the branch is already set by the worktree itself. We work directly on it:

```bash
# Just verify the current branch
git branch --show-current
```

The worktree branch becomes the working branch. Skip branch creation/switching.

**Regular repo mode:**

This is the main checkout, which other sessions share, so do not switch branches here (`guard-main-checkout` blocks it). Call `EnterWorktree` with `name: "hon-NN"`, the issue ID in lower case: the tool rejects a name over 64 characters, and most Linear branch names are longer. The `WorktreeCreate` hook resolves the ID to the issue's branch (an existing local or `origin` branch, else the `gitBranchName` from Linear), checks it out if it exists, and creates it from `origin/main` if not. Then continue as in worktree mode.

Only when the session runs with `WOBBLEPOT_ALLOW_MAIN_CHECKOUT=1` (the user chose the main checkout), switch branches in place. Check if branch already exists:

```bash
git branch --list "[gitBranchName]"
```

If branch exists:

```bash
git checkout [gitBranchName]
```

If branch doesn't exist:

```bash
git checkout -b [gitBranchName]
```

Verify you're on the correct branch:

```bash
git branch --show-current
```

### 8. Begin implementation

CLAUDE.md is already loaded as project instructions — do not re-read it. Read `docs/TYPOGRAPHY.md` only if the issue involves typography components.

Inform the user that setup is complete:

```
Ready to implement HON-XX: [Issue Title]

Branch: [gitBranchName]
Plan posted to Linear: [Yes/No/Skipped]
Status: In Progress

Implementation steps from plan:
1. [Step 1]
2. [Step 2]
...

Starting with step 1...
```

Then implement following the plan steps (or issue description if `--no-plan`).

**File follow-ups as you find them.** If the implementation shows a step this issue needs that the PR cannot ship (a golden re-record after a prompt change, a backfill after a migration), file it as a Linear issue before this skill ends, per `/plan-issue` → "A follow-up is an issue". Use the `save_issue` call in `/plan-issue` step 10: Queued or Todo, `blockedBy: ["HON-XX"]` when it needs this change on `main`, `addLabels: ["Follow-up"]`, the first description line `Follow-up to HON-XX, filed by /implement-issue.`, no prefix. A plan line still marked `to file:` (the filing failed when the plan was posted) is filed here too. A follow-up written only into the plan, a commit message or the summary is lost once this issue is Done.

**Work the plan's `## Coupled callsites` section too, if it has one.** It is a sibling of `## Implementation Steps`, not a member, so "follow the plan steps" walks straight past it. Every entry bucketed **Mirror** must be edited in this phase — the section exists because `/plan-issue` step 7b found callsites that hardcode a copy of the geometry you are changing, and leaving them for review is the failure that scan was written to prevent.

### 9. Signal completion

Before signalling completion, confirm the definition of done:

- **E2E drift**: if you touched `src/app/**/page.tsx`, a route URL, navigation/CTA copy, or a modal/dialog, grep `tests/e2e/` via the spec `// ROUTES: … · COMPONENTS: …` headers (`grep -l "ROUTES.*<route>\|COMPONENTS.*<Component>" tests/e2e/*.spec.ts`; for copy renames also `grep -rn "<exact old copy>" tests/e2e/`) and update affected specs (CLAUDE.md E2E rule)
- **Storybook**: if you touched `src/components/**`, create/update the colocated `.stories.tsx` and run `pnpm test-storybook:ci` (`.claude/rules/ui.md` → Storybook)
- **Coupled callsites**: if you changed a geometry default on a primitive under `src/components/ui/*.tsx`, a `@theme` token, or a shared layout wrapper, every **Mirror** is edited — from the plan's `## Coupled callsites` section if it has one, otherwise by running `/plan-issue` step 7b's greps now. Keyed off the diff, not the plan, so it still fires under `--no-plan` and on plans written before that section existed (CLAUDE.md shared-primitive geometry rule)
- **Follow-ups**: every step this issue needs that the PR does not ship has an issue ID, from the plan's `## Follow-ups` or filed in step 8
- **Driven screens**: if the diff changes a screen, drive it in the browser — see [Drive changed screens](#drive-changed-screens) below
- `pnpm lint && pnpm type-check && pnpm test` pass

#### Drive changed screens

Storybook and the E2E grep are static, so a layout break, a wrong empty state or a dead button passes both and is first seen on staging (HON-1188). Run this after the checks above pass, so the screen you drive is the one you ship.

**Trigger:** the branch's changes, uncommitted ones included, list a `.tsx` under `src/app/` (outside `src/app/api/` and `src/app/admin/`) or under `src/components/` (outside `src/components/ui/`), not counting `.stories.tsx` and `.test.tsx`. A `ui/` primitive is covered by its stories. Admin pages open only for `ADMIN_EMAIL`, which the review account is not, so do not change the admin gate to reach them. `scripts/pr-review.sh` uses the same trigger. Read the list from the merge base and the untracked files, because this step runs before the work is committed:

```bash
{ git diff --name-only "$(git merge-base origin/main HEAD)"; git ls-files --others --exclude-standard; } | sort -u
```

1. **Start the review server.** It turns on `/api/e2e-seed`, which `pnpm dev` does not, so sign-up works. Use `--db env` when the worktree `.env` has its own `DATABASE_URL` (`wt new`, `wt auto`), so it spends no second Neon branch; otherwise use branch mode:

   ```bash
   mine=$(grep '^DATABASE_URL=' .env); main=$(grep '^DATABASE_URL=' "$(git rev-parse --git-common-dir)/../.env")
   [ -n "$mine" ] && [ "$mine" != "$main" ] && echo "own database: --db env" || echo "shared database: branch mode"
   ```

   Start it with `run_in_background: true` and `timeout: 3600000`, with `--db env` appended after the `_` when the check printed it. When the screen needs seed data, also append `--seed`, in either mode. Do not run a bare `pnpm db:seed` for `--db env`: it keeps a `DATABASE_URL` the shell exports, so it can seed another database than the server reads (HON-1272). The 10-minute background default would kill the server partway through the screens, and a killed server leaves its Neon branch behind (`pnpm test:e2e:local gc` sweeps it). The port is a random free one, because up to three workers run at once. The pid file holds the script's own pid, so step 5 stops this server and no other:

   ```bash
   rm -f /tmp/review-HON-XX.pid; REVIEW_LOCAL_PORT=$(for p in $(seq 3201 3299 | sort -R); do curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$p/" || { echo "$p"; break; }; done) bash -c 'echo $$ > /tmp/review-HON-XX.pid; exec bash scripts/e2e-local.sh serve "$@"' _ > /tmp/review-HON-XX.log 2>&1
   ```

   Then wait in the foreground with `timeout: 540000`, in the same turn (CLAUDE.md → Waiting inside a skill):

   ```bash
   # 96 × 5 s = 480 s, under the 540 s foreground timeout.
   for i in $(seq 1 96); do
     # Alive 5 s after READY: if another server took the port, ours exits and READY was theirs.
     if grep -q REVIEW-READY /tmp/review-HON-XX.log 2>/dev/null; then
       sleep 5; kill -0 "$(cat /tmp/review-HON-XX.pid)" 2>/dev/null && { grep REVIEW-READY /tmp/review-HON-XX.log; exit 0; }
       tail -20 /tmp/review-HON-XX.log; echo REVIEW_FAILED; exit 1
     fi
     if [ -s /tmp/review-HON-XX.pid ] && ! kill -0 "$(cat /tmp/review-HON-XX.pid)" 2>/dev/null; then
       tail -20 /tmp/review-HON-XX.log; echo REVIEW_FAILED; exit 1
     fi
     sleep 5
   done
   echo REVIEW_WAITING
   ```

   `REVIEW_WAITING`: run it again. `REVIEW_FAILED` (no Neon slot, no Neon key, a refused `.env`): do not block the PR. Write a "Not verified" line with the reason from the log, and skip to step 5.

2. **Pick a browser** by `docs/CHROME_TESTING.md` → Which browser: the T3 Code sidebar browser (`preview_*`) first, then the Playwright MCP (`browser_*`). Skip the Chrome extension here, because it cannot save the screenshot file that step 4 uploads. The steps below give both sets of names; `docs/CHROME_TESTING.md` → Tool mapping pairs them. If neither is loaded (a worker without the Playwright MCP, `docs/PARALLEL_WORKFLOW.md` → Untracked Files), write a "Not verified" line that says so and skip to step 5.

   **Sign up a review account** in it (`docs/CHROME_TESTING.md` → Walking the flow). `curl -X POST <url>/api/e2e-seed` returns `{"code":…}`. Sign up on `<url>/sign-up` with that code, `review-<timestamp>@example.com` and `TEST_PASSWORD` from `tests/e2e/utils/test-helpers.ts`, then complete onboarding. Never use a real address or password.

   The T3 Code sidebar keeps its cookies between runs, and `localhost` cookies are shared across ports. So `<url>/sign-up` can redirect to `/` or `/onboarding` with a dev or an old review session, and the screens would be driven as that account (`src/app/sign-up/page.tsx`). If it redirects, open the user menu, click "Sign out", and load `/sign-up` again. The Playwright MCP starts with no cookies, so it never hits this.

   Then, before the first changed screen, answer the cookie banner once: `preview_snapshot` / `browser_snapshot`, find the "Essential only" button in the "Cookie consent" region (`src/components/CookieBanner.tsx`), and `preview_click` / `browser_click` it. The banner covers the bottom of every screen and intercepts clicks there (HON-1205). Click "Essential only", not "Accept all", because the review server may carry PostHog keys from `.env` and a review session must not count as a visitor. The consent cookie lasts for the browser session the tool keeps open, so do this once per run, not per screen. If the snapshot shows no banner, continue.
3. **For each changed screen**, with the browser from step 2: go to the route (`preview_navigate` / `browser_navigate`), then snapshot it (`preview_snapshot` / `browser_snapshot`). Do the issue's main action (`preview_click`, `preview_type`, … / `browser_click`, `browser_type`, …), snapshot again, and check the result against the acceptance criteria. Then save a screenshot and note its path: `preview_snapshot` with `save: true` returns `screenshotPath`, a PNG under `~/.t3/userdata/browser-artifacts/`; `browser_take_screenshot` with `filename: "hon-XX-<screen>.png"` reports its path. A defect you find here is fixed now, then driven again.
4. **Upload each screenshot to the Linear issue**, one file at a time: `prepare_attachment_upload` (`issue`, `filename` as `hon-XX-<screen>.png`, `contentType: "image/png"`, `size` from `wc -c < <path>`). Then `curl -X PUT --data-binary @<path>` to `uploadRequest.url`, with every header in `uploadRequest.headers` sent verbatim, within 60 seconds. Then `create_attachment_from_upload` with the `assetUrl`. If an upload fails, the `Driven:` line still stands. Say "screenshot not uploaded" on it.
5. **Stop the server:** `kill -TERM "$(cat /tmp/review-HON-XX.pid)"`. Its exit trap stops the dev server and, in branch mode, deletes the Neon branch. Close the tab with the set in use: `t3_preview_close` / `browser_close`.

**Evidence:** one line per screen, for the PR body's "Verified" list. It names the route, the action, what the snapshot showed, and the Linear attachment:

```
- Driven: `/shopping-list` — ticked "Milk"; the item moved to Done and the counter read 3/4. Screenshot `hon-XX-shopping-list.png` on HON-XX.
```

The PR body links the attachment by name, because `gh` cannot upload an image. `scripts/pr-review.sh` reports a PR that matches the trigger and has no `Driven:` line, unless "Not verified" says why the screen could not be driven.

After implementing all steps, output the completion marker exactly as shown:

```
[implement-issue:complete] Implementation complete for HON-XX
```

If this issue has follow-ups, print their IDs on the next line, so `/create-pr` can put them in the PR body: `Follow-ups: HON-AA (Queued, blocked by HON-XX), HON-BB (Todo)`. Print each `Driven:` line after it, for the same reason.

This marker signals to orchestrating skills (like `/auto-implement`) that implementation is finished. The calling context will determine what happens next.

## Edge Cases

| Scenario                    | Handling                                            |
| --------------------------- | --------------------------------------------------- |
| Issue doesn't exist         | Error: "Issue HON-XX not found in Linear"           |
| Issue Done/Canceled/Dup.    | Stop at step 3 gate; do not claim                   |
| Has open blockers           | Stop at step 3 gate; list blockers                  |
| Plan not in Linear comments | Offer to run `/plan-issue` or use `--no-plan`       |
| Plan is for different issue | Error: "Plan in comments is for HON-YY, not HON-XX" |
| Already on the branch       | Continue without creating new branch                |
| Assigned to someone else    | Warn and ask before reassigning                     |
| In worktree                 | Use worktree branch directly, skip branch creation  |
| Main checkout               | EnterWorktree (step 7); switch in place only with `WOBBLEPOT_ALLOW_MAIN_CHECKOUT=1` |

## Important

- Always verify the branch name matches Linear's `gitBranchName`
- Don't update issue status after PR is created (Linear automation handles it)
- If implementation reveals plan issues, suggest updating the plan
