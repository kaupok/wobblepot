#!/bin/bash
# Claude PR Reviewer
#
# Spawns a fresh Claude Code session to review a PR and post findings to GitHub.
# Uses Max subscription (not API credits) via the Claude CLI.
#
# The reviewer has NO context from the implementation session — it only sees
# the diff, the codebase, and project conventions (CLAUDE.md). This ensures
# unbiased review quality comparable to an external reviewer.
#
# Usage:
#   ./scripts/pr-review.sh <PR_NUMBER>
#   ./scripts/pr-review.sh --local <ISSUE_ID>
#
# The PR mode exits 0 when the review is posted, non-zero on error.
# Review results are posted as GitHub PR comments with a <!-- claude-review --> marker.
#
# The local mode (HON-1404) runs the same prompt on the branch's changes before a
# PR exists: commits, staged and unstaged edits and untracked files, against the
# merge base with origin/main. It runs no `gh` command and posts nothing. The
# summary goes to /tmp/auto-implement-local-review-<ISSUE_ID>.md. The PR-body
# checks are left out, because there is no body yet.

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=./models.sh
source "$SCRIPT_DIR/models.sh"
MODEL="$REVIEW_MODEL"

# ─── Colors ───────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

# ─── Argument validation ─────────────────────────────────────────────────────

usage() {
  echo -e "${RED}Usage: $0 <PR_NUMBER> | $0 --local <ISSUE_ID>${NC}"
  echo "  PR_NUMBER: The GitHub PR number to review"
  echo "  ISSUE_ID:  The Linear issue the local changes implement, e.g. HON-123"
  exit 1
}

[ $# -ge 1 ] || usage

MODE=pr
PR_NUMBER=""
LOCK_DIR=""
if [ "$1" = "--local" ]; then
  MODE=local
  [ $# -ge 2 ] || usage
  # HON only: the Spec gate below finds the ID with the same `hon-N` match it
  # uses on a branch name, so another prefix would skip the Spec check silently.
  if ! [[ "$2" =~ ^[Hh][Oo][Nn]-[0-9]+$ ]]; then
    echo -e "${RED}Error: ISSUE_ID must look like HON-123, got '$2'${NC}"
    exit 1
  fi
  LOCAL_ISSUE_ID=$(printf '%s' "$2" | tr '[:lower:]' '[:upper:]')
  OUT_FILE="/tmp/auto-implement-local-review-${LOCAL_ISSUE_ID}.md"
  LABEL="the local changes for ${LOCAL_ISSUE_ID}"
else
  PR_NUMBER="$1"
  LABEL="PR #${PR_NUMBER}"
  if ! [[ "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
    echo -e "${RED}Error: PR_NUMBER must be a positive integer, got '$PR_NUMBER'${NC}"
    exit 1
  fi
fi

# ─── Environment checks ──────────────────────────────────────────────────────

if ! command -v claude &> /dev/null; then
  echo -e "${RED}Error: Claude CLI not found${NC}"
  exit 1
fi

if [ "$MODE" = pr ] && ! command -v gh &> /dev/null; then
  echo -e "${RED}Error: GitHub CLI (gh) not found${NC}"
  exit 1
fi

# The comment fetch below slurps paginated output with the system jq rather than
# gh's embedded --jq — see the note at that call site (HON-586).
if ! command -v jq &> /dev/null; then
  echo -e "${RED}Error: jq not found${NC}"
  exit 1
fi

# Verify PR exists
if [ "$MODE" = pr ] && ! gh pr view "$PR_NUMBER" --json number &> /dev/null; then
  echo -e "${RED}Error: PR #${PR_NUMBER} not found${NC}"
  exit 1
fi

# The local mode's diff base. The merge base, not origin/main itself, so a
# stale worktree is not reviewed for every commit main gained since it branched.
if [ "$MODE" = local ]; then
  if ! BASE=$(git -C "$REPO_ROOT" merge-base origin/main HEAD 2>/dev/null); then
    echo -e "${RED}Error: no merge base with origin/main. Run git fetch origin main.${NC}"
    exit 1
  fi
fi

# ─── Lock to prevent duplicate reviews ────────────────────────────────────────
#
# PR mode only: the lock stops a second review comment on the same PR, and the
# local mode posts none.

[ "$MODE" = local ] || LOCK_DIR="/tmp/claude-review-${PR_NUMBER}.lock"
if [ -n "$LOCK_DIR" ] && ! mkdir "$LOCK_DIR" 2>/dev/null; then
  # Check if the other instance already posted a review
  # --paginate is mandatory: without it the API returns only the first page, so a marker
  # posted after the first 100 comments reads as absent and this branch reclaims a lock it
  # shouldn't. --jq cannot be used alongside it — gh applies --jq per page and would emit one
  # length per page instead of one total; `jq -s 'add'` folds the pages into a single array
  # first. Do not "simplify" this back to --jq (HON-586).
  #
  # The count is captured rather than tested inline because `set -o pipefail` would make an
  # `if` on this pipeline follow gh's exit status, and --paginate newly makes "marker printed
  # AND non-zero exit" reachable: gh exits non-zero when a later page fails after earlier pages
  # (possibly carrying the marker) already printed. That would reclaim a *live* instance's lock
  # and spawn a duplicate review. `|| true` prints nothing, so a total failure still leaves
  # MARKER_COUNT empty and falls through to the stale-lock path, which is intended.
  MARKER_COUNT=$(gh api --paginate "/repos/:owner/:repo/issues/${PR_NUMBER}/comments?per_page=100" 2>/dev/null \
    | jq -s 'add | [.[] | select(.body | startswith("<!-- claude-review -->"))] | length' 2>/dev/null \
    || true)
  if printf '%s\n' "$MARKER_COUNT" | grep -q '^[1-9]'; then
    echo -e "${GREEN}Review already posted by another instance.${NC}"
    exit 0
  fi
  # No review posted — stale lock from a crashed process. Clean up and proceed.
  echo -e "${RED}Stale lock found (no review posted). Reclaiming lock.${NC}"
  rmdir "$LOCK_DIR" 2>/dev/null || rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
fi

# ─── Review prompt ────────────────────────────────────────────────────────────

PROMPT_FILE=$(mktemp)
trap 'rm -f "$PROMPT_FILE"; [ -z "$LOCK_DIR" ] || rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

# Replace a placeholder in the prompt. Portable, unlike `sed -i ''`, which GNU sed
# reads as an empty script, so scripts/pr-review-local.test.ts can run on CI. The
# values are digits, an issue ID or a commit hash, so none needs escaping.
substitute() {
  local tmp
  tmp=$(mktemp)
  sed "s/$1/$2/g" "$PROMPT_FILE" > "$tmp" && mv "$tmp" "$PROMPT_FILE"
}

# The task, the quality bar and steps 1-5, shared with the local mode.
# shellcheck source=./pr-review-base.sh
source "$SCRIPT_DIR/pr-review-base.sh"
write_base_prompt "$PROMPT_FILE" "$MODE"
if [ "$MODE" = local ]; then
  substitute __BASE__ "$BASE"
else
  substitute __PR_NUMBER__ "$PR_NUMBER"
fi

# ─── Prose PRs: ask for a readability verdict ────────────────────────────────
#
# On a documentation-only PR the reviewer has no oracle — no failing test, no type
# error — so "what is wrong with this?" always has another defensible answer, and
# every answer makes the document longer. HON-627 rode that to 14 review rounds and
# ended with a document nobody could use. Asking for a usability verdict FIRST lets a
# finding that would make the artifact worse be dropped instead of posted.
#
# `grep -v` exits 1 when nothing matches and this runs under `set -o pipefail`, hence
# the `|| true` on the assignments. Two ways a fetch could wrongly read as "docs-only"
# and soften the review of a code PR, both closed here:
#
#   1. Empty  — a failed `gh pr view` yields no paths at all. The non-empty test.
#   2. Truncated — `gh` embeds a fixed `files(first: 100)` in its PR query and never
#      paginates, so a >100-file PR whose first 100 paths happen to be markdown would
#      look docs-only. Comparing the paths returned against `changedFiles` (a scalar
#      total, not subject to the page cap) catches that. A failed count leaves
#      PR_CHANGED empty, which cannot equal PR_FILE_COUNT — so it fails closed.
#
# The local mode reads the list from git, which has no cap, so the list is complete
# and every gate below runs as it does on a PR. An empty list is a wrong call.
if [ "$MODE" = local ]; then
  PR_FILES=$( { git -C "$REPO_ROOT" diff --name-only "$BASE"; git -C "$REPO_ROOT" ls-files --others --exclude-standard; } | sort -u)
  if [ -z "$PR_FILES" ]; then
    echo -e "${RED}Error: no changes since origin/main to review${NC}"
    exit 1
  fi
else
  PR_FILES=$(gh pr view "$PR_NUMBER" --json files --jq '.files[].path' 2>/dev/null || true)
fi
NON_MD=$(printf '%s\n' "$PR_FILES" | grep -v '\.md$' || true)
PR_FILE_COUNT=$(printf '%s\n' "$PR_FILES" | grep -c . || true)
if [ "$MODE" = local ]; then
  PR_CHANGED="$PR_FILE_COUNT"
else
  PR_CHANGED=$(gh pr view "$PR_NUMBER" --json changedFiles --jq '.changedFiles' 2>/dev/null || true)
fi

if [ -n "$PR_FILES" ] && [ -z "$NON_MD" ] && [ "$PR_FILE_COUNT" = "$PR_CHANGED" ]; then
  echo -e "${GREEN}Documentation-only PR — adding the readability-regression instruction.${NC}"
  cat >> "$PROMPT_FILE" <<'PROSE_PROMPT'

## This PR changes documentation only — judge readability first

Every file in this diff is a `*.md` document. These are read and acted on by agents and by people, so length and clarity are part of correctness: a change that improves accuracy while making the document unusable is a net regression.

So judge readability as well as correctness, and report the judgement as a one-line verdict:

> **Usability:** more usable / about the same / less usable than before this change — [one sentence why]

**Where the verdict goes:** inside the Step 5 summary comment, on the line directly below the `### Claude review` heading and above the 2-3 sentence summary. It does NOT go anywhere else, and it does NOT change the shape of that comment: `<!-- claude-review -->` must still be the very first line of the body, with nothing before it. Automation locates every review by that exact prefix, so a verdict emitted above it makes the whole round invisible and the run stops as if no review had been posted.

Then apply that verdict to your findings:

- **Drop** any finding whose fix would make the document longer or harder to follow without correcting something that is actually wrong. "This does not cover the case where X", "consider also noting Y", and "this could be more precise" are coverage suggestions, not defects.
- **Keep** genuine defects: a broken reference (a path, line number, step number, or command that does not resolve), a factually wrong statement, an instruction that would cause the wrong action, or an internal contradiction.
- If the verdict is "less usable", say what to **cut**. That is a more valuable finding than anything you could add.

**A "less usable" verdict is itself a finding, and must be filed as one.** Do NOT write "No issues found" in a summary whose verdict is "less usable" — automation substring-tests for that phrase to decide the review was clean and merges on it, so the regression would be discarded silently, which is the exact outcome this section exists to prevent. When the verdict is "less usable", the "Issues found" list must have at least one entry naming what to cut. "No issues found" is correct only when the verdict is "more usable" or "about the same" and you have no other findings.
PROSE_PROMPT
fi

# ─── UI PRs: check the changed UI against docs/DESIGN.md ─────────────────────
#
# docs/DESIGN.md is the guidance half of the loop — read before UI is built. This
# is the other half: the review that checks the result against it, and that feeds
# the next rule back into the doc (HON-615).
#
# The gate is computed here rather than asked of the model, so the doc is read only
# when the diff can actually violate it, and a no-UI PR cannot spend a turn deciding.
#
# It fails CLOSED, because the two branches are not "check" and "skip": the else
# branch instructs `not applicable (no UI files)`, an affirmative claim written into
# the record the line exists to be. PR_FILES is empty whenever `gh pr view` fails and
# is capped at 100 paths (HON-587), so a PR that is entirely UI can arrive here with
# an empty UI_FILES. Make the claim only when the list backing it was readable and
# complete — the two conditions the prose gate above already evaluates — and check
# the guide otherwise. Reading it needlessly costs one file read; a false "not
# applicable" costs the audit trail.
if [ -n "$PR_FILES" ] && [ "$PR_FILE_COUNT" = "$PR_CHANGED" ]; then
  PR_FILES_COMPLETE=true
else
  PR_FILES_COMPLETE=false
fi
# The pattern is "anything that renders UI", not "component files":
#   - .css as well as .tsx, because src/app/globals.css holds the @theme token block
#     and half the reject list is about tokens — a raw palette class where a token
#     exists, a `dark:` override on a semantic token, arbitrary font sizes. A
#     token-only PR changes no .tsx at all (CLAUDE.md routes `@theme` and
#     `--spacing-*` changes through docs/DESIGN.md for the same reason).
#   - src/stories as well, because src/stories/scenarios/* composes whole screens and
#     is where the composition rules become visible at all (HON-610). A .ts there is
#     deliberately excluded: design-rules.ts implements the mechanical checks, it does
#     not render anything a reject-list item could apply to.
# Each omission would have handed the affirmative "no UI files" claim to a diff the
# guide speaks directly to — the same false negative the guard above prevents.
#
# Note for whoever edits DESIGN_PROMPT below, not an instruction the reviewer sees:
# the mechanical half of the reject list is already checked twice before a review
# runs. design-rules.ts asserts four rules against the scenario DOM in
# `pnpm test-storybook:ci`, and five @shadcn/lint rules run in `pnpm lint` — raw and
# undeclared colours, arbitrary values, unknown classes, inline styles, and dynamic
# classNames on a design-system component's callsite (HON-673). Both are red on the
# PR before the reviewer starts, so those findings arrive by a cheaper route. That is
# an argument for keeping the prompt below pointed at the Reject list and Composition
# rules — judgment no checker can make — and not for adding mechanical checks to it.
# It is deliberately NOT in the prompt: telling the reviewer a class of finding is
# "covered" invites it to skip a real one, and `no-raw-colors` and
# `require-static-classes` both have real gaps (a `dark:` override on a semantic
# token; a template literal on a plain <div>).
UI_FILES=$(printf '%s\n' "$PR_FILES" | grep -E '^src/(components|app|stories)/.*\.(tsx|css)$' || true)

if [ -n "$UI_FILES" ] || [ "$PR_FILES_COMPLETE" = false ]; then
  if [ -n "$UI_FILES" ]; then
    echo -e "${GREEN}UI files changed — adding the design-guide instruction.${NC}"
  else
    echo -e "${YELLOW}File list unreadable or truncated — checking the design guide rather than claiming it does not apply.${NC}"
  fi
  cat >> "$PROMPT_FILE" <<'DESIGN_PROMPT'

## Also check the changed UI against the design guide

Read `docs/DESIGN.md` before step 4 and check the changed UI against its **Reject list** and **Composition rules** sections only. The rest of that document is guidance for building, not a review checklist — do not review against it.

You may reach this instruction on a diff that turns out to change no UI: the file list backing the gate can come back unreadable or truncated, in which case the check runs rather than claim it does not apply. That outcome is `— 0 findings` on the summary line below. There is no third verdict — do not invent findings to fill it, and do not write your own wording for it.

A design finding qualifies only when it matches a **named** item in one of those two sections: a Card nested inside a Card, a sticky action bar inside content, a page title above `text-xl`, a raw palette class where a token exists, and so on. **Name the item you matched**, so the finding can be checked against the document. Anything the document does not name is taste, and the substantive-only bar above still applies to it: do not post it.

One exception to "named items only": if the same unnamed pattern appears **twice** in this diff, that repetition is itself worth reporting — put it in the summary comment as a proposed new **Reject list** entry, citing both sightings. Do not post it as an inline finding.

**A proposed reject-list entry is a finding, and must be filed as one.** List it in the summary comment's `**Issues found:**` list, not only in the prose around it, and do NOT write "No issues found" in a summary that proposes one — automation substring-tests for that phrase to decide the review was clean and merges on it, so the proposal would be discarded silently. Naming the pattern is the only way the guide grows a rule for it, which is the whole reason this exception exists.

**Report the check in the summary comment.** In the Step 5 body, on its own line directly above the `**Issues found:**` list, emit exactly:

**Design guide:** checked against docs/DESIGN.md — N findings

where N is how many design-guide findings you are reporting; `0` is a valid and common answer. Emit the line even when N is 0 — it is what makes the check observable from the PR page and what a later audit greps for. It does not change the shape of the comment: `<!-- claude-review -->` must still be the very first line of the body, with nothing before it.
DESIGN_PROMPT
else
  echo -e "${GREEN}No UI files changed — the design guide does not apply.${NC}"
  cat >> "$PROMPT_FILE" <<'NO_DESIGN_PROMPT'

## This PR touches no UI files — the design guide does not apply

Nothing in this diff renders UI, so nothing here can violate the design guide. **Do not open `docs/DESIGN.md` to check other files against it**, and do not raise design findings.

That is a rule about reviewing *against* the guide, not about the file. If `docs/DESIGN.md` is itself in the diff — which is what the feedback half of this loop produces, a PR that adds a Reject list entry — step 2 still applies in full: read it as a changed file and review the change on its own terms.

Record that in the Step 5 summary comment, on its own line directly above the `**Issues found:**` list, exactly:

**Design guide:** not applicable (no UI files)

`<!-- claude-review -->` must still be the very first line of the body, with nothing before it.
NO_DESIGN_PROMPT
fi

# ─── Checklist items for CLAUDE.md rules that no CI check can enforce ────────
#
# Five rules have no mechanical check, so they live here as reviewer checklist items:
# the CLAUDE.md "definition of done" rules for E2E drift and shared-primitive geometry
# (HON-729), test anti-patterns (HON-1198), the AI eval report (HON-904), and the
# driven-screen evidence (HON-1188). Each is appended only when the diff touches the
# paths the rule is about, so a PR that cannot break the rule does not pay for the
# check. All five fail closed on an unreadable or truncated file list, like
# the design gate above. None emits a "not applicable" line: the item's own "nothing to do" clause covers a gate that
# fired on a diff the rule turns out not to apply to.
#
# E2E drift: routes and dialogs live in .tsx under src/app and src/components, and
# user-visible copy lives in the next-intl catalogs, which is what specs assert on.
# src/proxy.ts owns the anonymous-redirect behaviour tests/e2e/auth-redirect.spec.ts
# asserts on, so a proxy-only PR can drift a spec without touching a .tsx.
# Stories and unit tests are excluded — no spec can drift from them.
E2E_FILES=$(printf '%s\n' "$PR_FILES" | grep -E '^(src/(app|components)/.*\.tsx|messages/[^/]*\.json|src/proxy\.ts)$' | grep -vE '\.(stories|test)\.tsx$' || true)
# Geometry: the primitives themselves, and the stylesheet holding the @theme tokens.
GEOMETRY_FILES=$(printf '%s\n' "$PR_FILES" | grep -E '^(src/components/ui/[^/]*\.tsx|src/app/globals\.css)$' | grep -vE '\.(stories|test)\.tsx$' || true)
# Test anti-patterns: a test whose expected value is computed the way the code computes
# it, or that asserts a mock was called, passes on day one and never catches a
# regression. CI runs it green, so only a reader can see it. Unit tests, E2E specs, and
# stories, because a play function is a test. Tests are colocated, so any path counts.
TEST_FILES=$(printf '%s\n' "$PR_FILES" | grep -E '(\.(test|spec)\.(ts|tsx)|\.stories\.tsx)$' || true)
# AI eval: what `scripts/model-bench/tasks.ts` imports from src/lib/ai/ — the model
# constants, the route budgets, and the request builders — plus the two schema files
# the builders send (recipe-schema.ts, types.ts), whose `.describe()` strings are
# instructions to the model, the vague-phrase list recipe-prompt.ts joins into its
# instructions (src/lib/vague-quantities.ts), and the committed cases.
# The eval spends money, so CI cannot run it, and HON-794 changed `models.ts` with no
# run at all (HON-859 ran it after the fact). Drafts are gitignored and never loaded,
# and the README is prose, so neither changes what the eval measures.
AI_EVAL_FILES=$(printf '%s\n' "$PR_FILES" | grep -E '^(src/lib/ai/(models|budgets|prompts|recipe-prompt|recipe-schema|types|imagine-request|review-request|preparation-steps|cook-question)\.ts|src/lib/vague-quantities\.ts|scripts/model-bench/cases/.*\.json)$' | grep -vE '\.(test\.ts|draft\.json)$' || true)

if [ -n "$E2E_FILES" ] || [ "$PR_FILES_COMPLETE" = false ]; then
  echo -e "${GREEN}Pages, components or copy changed — adding the E2E-drift check.${NC}"
  cat >> "$PROMPT_FILE" <<'E2E_PROMPT'

## Also check for E2E drift

If this diff changes a route (a `src/app/**/page.tsx` added, moved or removed, or a `<Link>` / `router.push` target), user-visible heading, button, link or modal copy, or a dialog's structure, find the specs that assert on it — `grep -l "ROUTES.*<route>\|COMPONENTS.*<Component>" tests/e2e/*.spec.ts`, plus `grep -rn "<old copy>" tests/e2e/` for a copy change — and check they were updated in this PR. A spec still asserting on a removed route or the old copy is a finding (CLAUDE.md E2E rule, HON-518). If none of those changed, this check has nothing to do.
E2E_PROMPT
fi

if [ -n "$GEOMETRY_FILES" ] || [ "$PR_FILES_COMPLETE" = false ]; then
  echo -e "${GREEN}Primitives or theme tokens changed — adding the shared-geometry check.${NC}"
  cat >> "$PROMPT_FILE" <<'GEOMETRY_PROMPT'

## Also check shared-primitive geometry

If this diff changes a size, height, padding or radius default on a primitive under `src/components/ui/`, or a `@theme` token in `src/app/globals.css`, run the greps in `.claude/skills/plan-issue/SKILL.md` step 7b against the **old** literal and check that every Mirror hit — a skeleton or sibling primitive sized to match — moved with it in this PR. An unmoved Mirror is a finding (HON-612 desynced 12 `loading.tsx` skeletons this way); Override and Deliberate hits are not. If no geometry default changed, this check has nothing to do.
GEOMETRY_PROMPT
fi

if [ -n "$TEST_FILES" ] || [ "$PR_FILES_COMPLETE" = false ]; then
  echo -e "${GREEN}Tests, specs or stories changed — adding the test anti-pattern check.${NC}"
  cat >> "$PROMPT_FILE" <<'TEST_PROMPT'

## Also check that the changed tests can fail

A test that cannot fail passes CI on day one and never catches a regression. For each test, spec or story play function added or changed in this PR, report it as a finding if it is one of these:

- **Tautological**: the expected value is recomputed the way the code computes it (`expect(total(items)).toBe(items.reduce(...))`), a constant is asserted equal to itself, or a snapshot is derived by the same logic. Fix: take the expected value from a literal, a worked example, or the issue's acceptance criteria.
- **Implementation-coupled**: it mocks an internal collaborator of the unit under test, asserts call counts or call order where the behaviour is observable through the interface, or verifies through a side channel (a direct Prisma query) when the public interface can show the result. Fix: assert on what the interface returns or renders. Mocking a network boundary (MSW, `apiFetch`) or a paid service is not a finding.
- **Unable to go red**: the assertion would pass if the implementation were deleted (`expect(result).toBeDefined()` on a function that always returns an object, `not.toThrow()` with no other assertion). Fix: assert the specific value or state the change produces.

Anchor the finding on the assertion and name which of the three it is. If no test file changed, this check has nothing to do.
TEST_PROMPT
fi

if [ -n "$AI_EVAL_FILES" ] || [ "$PR_FILES_COMPLETE" = false ]; then
  echo -e "${GREEN}AI prompts, models, budgets or eval cases changed — adding the eval-report check.${NC}"
  cat >> "$PROMPT_FILE" <<'AI_EVAL_PROMPT'

## Also check for an AI eval report

If this diff changes a prompt builder or text it sends to the model (an output schema in `src/lib/ai/recipe-schema.ts` or `src/lib/ai/types.ts`, the phrase list in `src/lib/vague-quantities.ts`), a model constant, an AI budget or a benchmark case, the PR body must cite a report under `scripts/model-bench/results/` committed in this PR and dated after the change: a `--check` report for a case or budget change, a `--baseline golden` comparison with judge verdicts for a prompt, schema or phrase-list change, a model comparison for a `models.ts` change (`docs/AI_MODELS.md`). A missing or older report is a finding. So is a golden comparison whose header reads `unchanged` for a task the diff changes, or one beside a `scripts/model-bench/golden/` change in the same PR: either way the golden was recorded on the new prompt, and the report compares it with itself. If none of those files changed, this check has nothing to do.
AI_EVAL_PROMPT
fi

# Driven screens: /implement-issue step 9 → "Drive changed screens" opens each changed
# screen through the Playwright MCP and records a `Driven:` line in the PR body. Pages
# and route files under src/app, and feature components; a src/components/ui primitive
# is covered by its stories, src/app/api renders no screen, and src/app/admin opens
# only for ADMIN_EMAIL, which a fresh review account is not. The item fires only
# when the body has no `Driven:` list line, so a PR that carries the evidence pays
# nothing. A failed body fetch reads as "no line", which fails closed like the gates above.
DRIVE_FILES=$(printf '%s\n' "$PR_FILES" | grep -E '^src/(app|components)/.*\.tsx$' | grep -vE '^src/(app/(api|admin)|components/ui)/|\.(stories|test)\.tsx$' || true)
# The local mode has no body yet, and so no place for a `Driven:` line: the item is
# left out there, and the PR review asks for the lines once the body exists.
if [ "$MODE" = pr ]; then
  PR_BODY=$(gh pr view "$PR_NUMBER" --json body --jq '.body' 2>/dev/null || true)
else
  PR_BODY=""
fi
DRIVEN_IN_BODY=$(printf '%s\n' "$PR_BODY" | grep -cE '^[[:space:]]*[-*][[:space:]]+Driven:' || true)

if [ "$MODE" = pr ]; then
  if { [ -n "$DRIVE_FILES" ] || [ "$PR_FILES_COMPLETE" = false ]; } && [ "$DRIVEN_IN_BODY" = 0 ]; then
    echo -e "${GREEN}Screens changed and the PR body has no Driven: line — adding the driven-screen check.${NC}"
    cat >> "$PROMPT_FILE" <<'DRIVE_PROMPT'

## Also check that the changed screens were driven

This diff changes a page or a feature component, and the PR body has no `Driven:` line. `.claude/skills/implement-issue/SKILL.md` → "Drive changed screens" requires one per changed screen: the route, the action, the result the browser showed, and the screenshot on the Linear issue. Report the missing lines as a finding in the summary (the body is not in the diff), naming the screens the diff changes. It is not a finding when the body's "Not verified" list says why the screens could not be driven (the review server or the Playwright MCP could not start, or the screen needs an account the review server cannot create, with the reason), or when the changed files render nothing a user sees (a type or prop rename with no visible change). In that case this check has nothing to do.
DRIVE_PROMPT
  fi
fi

# ─── PR body: Verified / Not verified, no checkboxes ─────────────────────────
#
# The PR templates in /create-pr and /auto-implement replaced the `- [ ]` test plan
# with "Verified" and "Not verified" lists (HON-860): unticked boxes merged on 26 of
# 53 PRs, mostly restating what a test already proved, and hid the few real gaps.
# Nothing else reads the body, so this is the only check on it. Every PR has a body,
# so unlike the items above it is appended on every PR-mode run. The local mode runs
# before the body exists, so it has nothing to check.
if [ "$MODE" = pr ]; then
  cat >> "$PROMPT_FILE" <<'PR_BODY_PROMPT'

## Also check the PR body's Verified / Not verified lists

Read the body from step 1. Report each of these as a finding in the summary comment's `**Issues found:**` list (the body is not in the diff, so there is no line to anchor an inline comment to):

- **Any `- [ ]` checkbox in the body.** PR bodies carry no checkboxes; a box is a step for a human nobody will perform. Say whether it belongs under "Verified" (cite the test that proves it) or "Not verified" (with the reason).
- **A "Verified" line that names no command, test, story or spec.** "Checked the layout" is intent, not verification.
- **A "Not verified" item whose failure would break the change's stated purpose, and that a test, story or spec in this repo could have checked.** That is a gap in the change, not a footnote. An item that genuinely cannot be checked from a session (credentials, a real device, a paid API call, only observable after merge) is what the list is for; do not report it.

**A PR-body finding is a finding.** Do NOT write "No issues found" anywhere in a summary that lists one, even if the diff itself is clean. Automation substring-tests for that phrase to decide the review was clean and merges on it, and a PR-body finding never has an inline comment to fall back on.
PR_BODY_PROMPT
fi

# ─── Spec axis: the diff against the issue's acceptance criteria ─────────────
#
# Everything above reviews the diff against standards. None of it reads the Linear
# issue, so a PR that follows every rule and implements half the issue gets "No
# issues found" and merges (HON-1200). The Spec axis is reported in its own list so
# a clean Standards review cannot mask a Spec gap, after Matt Pocock's code-review
# skill. A criterion that only looks implemented is reported as Unproven: the
# reviewer names the test, `Driven:` line or eval report that observes it (HON-1236).
#
# The issue ID comes from the branch first (`gitBranchName` always carries it), then
# from a closing keyword in the body: every PR template writes `Closes HON-XX`, and a
# bare first `HON-N` would pick up a history reference like HON-860 and review the PR
# against the wrong issue. A failed fetch leaves the ID empty, which skips the axis
# with an observable "no issue linked" line rather than failing the review.
# The local mode takes the ID from its argument, through the same match: `HON-N`
# passes `(^|/)hon-[0-9]+`, and the empty body adds nothing.
if [ "$MODE" = pr ]; then
  PR_HEAD=$(gh pr view "$PR_NUMBER" --json headRefName --jq '.headRefName' 2>/dev/null || true)
else
  PR_HEAD="$LOCAL_ISSUE_ID"
fi
ISSUE_ID=$( { printf '%s\n' "$PR_HEAD" | grep -oiE '(^|/)hon-[0-9]+' | grep -oiE 'hon-[0-9]+'; printf '%s\n' "$PR_BODY" | grep -oiE '(closes|fixes|resolves) hon-[0-9]+' | grep -oiE 'hon-[0-9]+'; } | head -n 1 | tr '[:lower:]' '[:upper:]' || true)

if [ -n "$ISSUE_ID" ]; then
  echo -e "${GREEN}PR is linked to ${ISSUE_ID} — adding the spec check.${NC}"
  cat >> "$PROMPT_FILE" <<'SPEC_PROMPT'

## Also check the diff against the issue (Spec)

This PR implements Linear issue __ISSUE_ID__. Everything above checks the diff against standards; this checks it against what the issue asked for. Report the two separately, so a clean result on one cannot hide a gap in the other.

1. Fetch the issue with `mcp__linear-server__get_issue` (`id: "__ISSUE_ID__"`, `includeRelations: true`) and its comments with `mcp__linear-server__list_comments` (`issueId: "__ISSUE_ID__"`). The plan is the comment whose body starts `# Plan:`; there may be none. If the issue fetch fails, write `**Spec:** issue not readable` in the summary and skip the rest of this section. That line is not a finding.
2. Compare the diff with the issue's acceptance criteria (and its "What" section where it has no criteria list). Report each of these:
   - **Missing**: a criterion the diff does not implement, or implements only in part. Quote the criterion, and say "partly" when part of it is there.
   - **Not asked for**: behaviour in the diff that neither the issue nor the plan asked for. A change the plan's Design Decisions choose, with a reason, is asked for; so is a test, story or doc edit that supports a criterion.
   - **Implemented but wrong**: a criterion the diff appears to implement, but whose result does not match what the criterion says.
   - **Unproven**: the diff implements it, but nothing in the PR shows the result. For each criterion the diff appears to implement, name what observes the result: a test that asserts the literal value (in the diff, or an existing test the PR body names), a `Driven:` line or a `measured:` Proof line in the PR body that reports it, an eval report, or, for a criterion of the form "lint / type-check / tests pass", the CI check itself. Code that looks right is not proof. Report a criterion with none of these.

   Label each line with one of those four kinds, exactly as written, then the file and one sentence. A criterion that only a human can check after merge (a production metric, a staging walk-through) is not a finding.
3. Put the result in the Step 5 summary comment, under its own heading directly below the `**Issues found:**` list and above `**Confidence:**`:

   **Spec:** checked against __ISSUE_ID__ — N findings
   1. **Missing** (file) — "[quoted criterion]" — [one sentence]
   2. **Unproven** (file) — "[quoted criterion]" — [what the diff does, and the test or `Driven:` line that would show it]
   3. ...

   `0 findings` is a valid answer: emit the heading line on its own. Do NOT copy a Spec finding into the `**Issues found:**` list, and do not rank one list against the other. Spec findings go in the summary only, not as inline comments.

**A Spec finding is a finding.** Do NOT write "No issues found" anywhere in a summary whose Spec list is non-empty. Automation substring-tests for that phrase to decide the review was clean and merges on it. When the diff has no bugs but the Spec list has entries, write "No bugs found in the diff." in the `**Issues found:**` list instead.
SPEC_PROMPT
  substitute __ISSUE_ID__ "$ISSUE_ID"
else
  echo -e "${YELLOW}No HON issue ID in the branch name or a closing keyword in the body — skipping the spec check.${NC}"
  cat >> "$PROMPT_FILE" <<'NO_SPEC_PROMPT'

## No issue is linked — the spec check does not apply

Neither the branch name nor a `Closes HON-NNN` line in the body names a Linear issue, so there are no acceptance criteria to check the diff against. In the Step 5 summary comment, directly below the `**Issues found:**` list, write exactly:

**Spec:** no issue linked

That line is not a finding. `<!-- claude-review -->` must still be the very first line of the body.
NO_SPEC_PROMPT
fi

REVIEW_PROMPT=$(cat "$PROMPT_FILE")

# ─── Run the reviewer ─────────────────────────────────────────────────────────

echo -e "${GREEN}Starting Claude review for ${LABEL}${NC}"
echo -e "Model: ${MODEL} | Effort: ${REVIEW_EFFORT:-default}"
echo -e "Repository root: ${REPO_ROOT}"
echo "─────────────────────────────────────────"

cd "$REPO_ROOT"

# Unset ANTHROPIC_API_KEY so Claude CLI uses Max subscription instead of API credits
# Capture exit code manually since set -e would exit before our error message
EXIT_CODE=0
# An empty REVIEW_EFFORT passes no --effort flag (HON-1193).
claude_model_args "$MODEL" "$REVIEW_EFFORT"
# The reviewer reads the Linear issue and plan; no other MCP server (HON-1238).
claude_mcp_args linear-server
REVIEWER=(env -u ANTHROPIC_API_KEY claude -p
  --dangerously-skip-permissions
  "${CLAUDE_MODEL_ARGS[@]}"
  "${CLAUDE_MCP_ARGS[@]}"
  -- "$REVIEW_PROMPT")

if [ "$MODE" = pr ]; then
  "${REVIEWER[@]}" || EXIT_CODE=$?
else
  # The summary is the reviewer's final answer on stdout. Write it beside the target
  # and move it in only when it carries the marker, so a failed run never leaves a
  # stale or partial file that reads as this run's review.
  rm -f "$OUT_FILE"
  "${REVIEWER[@]}" > "$OUT_FILE.tmp" || EXIT_CODE=$?
  if [ $EXIT_CODE -eq 0 ] && ! grep -q '^<!-- claude-review -->' "$OUT_FILE.tmp"; then
    echo -e "${RED}The reviewer printed no <!-- claude-review --> summary${NC}"
    EXIT_CODE=1
  fi
  if [ $EXIT_CODE -eq 0 ]; then
    mv "$OUT_FILE.tmp" "$OUT_FILE"
  else
    rm -f "$OUT_FILE.tmp"
  fi
fi

if [ $EXIT_CODE -eq 0 ]; then
  echo -e "\n${GREEN}Review complete for ${LABEL}${NC}"
  [ "$MODE" = pr ] || echo "Findings: ${OUT_FILE}"
else
  echo -e "\n${RED}Review failed for ${LABEL} (exit code: ${EXIT_CODE})${NC}"
fi

exit $EXIT_CODE
