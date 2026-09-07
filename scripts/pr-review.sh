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
#
# The script exits 0 when the review is posted, non-zero on error.
# Review results are posted as GitHub PR comments with a <!-- claude-review --> marker.

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MODEL="${CLAUDE_REVIEW_MODEL:-claude-opus-5}"

# ─── Colors ───────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

# ─── Argument validation ─────────────────────────────────────────────────────

if [ $# -lt 1 ]; then
  echo -e "${RED}Usage: $0 <PR_NUMBER>${NC}"
  echo "  PR_NUMBER: The GitHub PR number to review"
  exit 1
fi

PR_NUMBER="$1"

if ! [[ "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
  echo -e "${RED}Error: PR_NUMBER must be a positive integer, got '$PR_NUMBER'${NC}"
  exit 1
fi

# ─── Environment checks ──────────────────────────────────────────────────────

if ! command -v claude &> /dev/null; then
  echo -e "${RED}Error: Claude CLI not found${NC}"
  exit 1
fi

if ! command -v gh &> /dev/null; then
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
if ! gh pr view "$PR_NUMBER" --json number &> /dev/null; then
  echo -e "${RED}Error: PR #${PR_NUMBER} not found${NC}"
  exit 1
fi

# ─── Lock to prevent duplicate reviews ────────────────────────────────────────

LOCK_DIR="/tmp/claude-review-${PR_NUMBER}.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
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
trap 'rm -f "$PROMPT_FILE"; rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

cat > "$PROMPT_FILE" <<'PROMPT'
You are reviewing PR #__PR_NUMBER__ in the Honkadori project. You are a fresh reviewer with NO context from the implementation — you only see the final diff and the codebase.

## Your task

1. Get the PR diff and understand what changed
2. Read the changed files IN FULL (not just the diff lines) for surrounding context
3. Explore related code — callers, schema, API routes, similar patterns
4. Find real bugs and post findings to GitHub

## What to look for

Focus ONLY on substantive issues. These are what matter:

- **Logic errors** — wrong calculations, off-by-one, incorrect conditions. Show with concrete values from the actual code (e.g. "2 eggs x 55g = 170 kcal expected, but code produces 3.1 kcal")
- **Data flow bugs** — mismatched types between API and consumer, missing fields, null handling gaps
- **Missing validation** — inputs that bypass server-side checks, invariants not enforced
- **Cross-file inconsistencies** — same bug in multiple places, schema mismatches between Prisma model and API response
- **Security issues** — auth bypasses, injection, data exposure
- **Race conditions** — state ordering bugs, missing locks, stale reads

Do NOT comment on:
- Code style or formatting (Prettier handles this)
- Naming preferences or conventions
- TypeScript type suggestions that don't affect correctness
- "Consider" suggestions without concrete impact
- Things that are already handled elsewhere in the codebase

## Quality bar for every comment

Every comment you post MUST include ALL of these:

1. **Bold title** summarizing the issue in one line
2. **What is wrong** — with actual values from the code, not hypotheticals
3. **What breaks** — the concrete impact (wrong data, crash, security hole)
4. **How to fix it** — a code suggestion when possible, using \`\`\`suggestion blocks for inline fixes

Example of a GOOD comment:

> **Incorrect nutrition factor for piece-unit ingredients**
>
> The calculation always divides quantity by 100, which works for grams but not pieces. For 2 eggs with gramsPerPiece=55 and calories=155/100g:
> - Expected: (2 x 55) / 100 x 155 = 170 kcal
> - Actual: 2 / 100 x 155 = 3.1 kcal — 55x too low
>
> \`\`\`suggestion
> const gramsPerPiece = ing.gramsPerPiece ?? null
> const quantityInGrams = ing.defaultUnit === 'piece' && gramsPerPiece != null
>   ? (row.totalQuantity / servingsNum) * gramsPerPiece
>   : row.totalQuantity / servingsNum
> const factor = quantityInGrams / 100
> \`\`\`

Example of a BAD comment (do NOT post comments like this):

> Consider adding error handling here in case the API returns null.

## Step-by-step execution

### Step 1: Get the diff and changed files

Run these commands:
\`\`\`bash
gh pr diff __PR_NUMBER__
gh pr view __PR_NUMBER__ --json title,body --jq '{title: .title, body: .body}'
# The file list comes from the paginated REST endpoint, NOT `--json files`: that
# caps at 100 and cannot paginate (HON-587), so on a large PR you would silently
# review the first 100 paths and report "no issues found" on the rest unseen.
gh api --paginate "/repos/:owner/:repo/pulls/__PR_NUMBER__/files?per_page=100" | jq -rs 'add | .[].filename'
\`\`\`

### Step 2: Read changed files in full

For each changed file, read the COMPLETE file (not just the diff) to understand the full context. This is critical for finding cross-file bugs.

### Step 3: Explore related code

For each significant change, use Grep and Read to find:
- Where changed functions/components are called from
- Related Prisma models in prisma/schema.prisma
- API routes that consume or produce the affected data
- Other files with similar patterns that might have the same bug

### Step 4: Post inline review comments

Collect ALL issues you found. Post them as a single bundled GitHub review.

IMPORTANT: Construct a valid JSON payload with the review body and comments array. Pipe it to \`gh api\` via \`--input -\`. The \`{owner}\` and \`{repo}\` placeholders are auto-filled by \`gh api\`.

\`\`\`bash
# Post a review with inline comments — pipe JSON via stdin
echo '{
  "event": "COMMENT",
  "body": "",
  "comments": [
    {
      "path": "src/example/file.ts",
      "line": 42,
      "body": "**Issue title**\\n\\nExplanation...\\n\\n\`\`\`suggestion\\nfixed code\\n\`\`\`"
    }
  ]
}' | gh api /repos/{owner}/{repo}/pulls/__PR_NUMBER__/reviews --method POST --input -
\`\`\`

The \`line\` field must be a line number in the NEW version of the file (right side of the diff). Use the diff hunks to find the correct line numbers.

If a finding relates to code OUTSIDE the diff (e.g. a pre-existing bug you discovered while reviewing), include it in the summary comment instead.

Rules for inline comments:
- Maximum 5 inline comments — focus on the most impactful issues
- Every comment must be substantive (no nitpicks)
- Use \`\`\`suggestion blocks when you have a concrete fix

### Step 5: Post summary comment

Post an issue-level summary comment. This MUST start with the HTML marker on the very first line:

\`\`\`bash
gh api /repos/{owner}/{repo}/issues/__PR_NUMBER__/comments \\
  --method POST \\
  -f body="<!-- claude-review -->
### Claude review

[2-3 sentence summary of what the PR does and your overall assessment]

**Issues found:**
1. **[Issue title]** (file:line) — [one sentence]
2. ...

(If no issues: No issues found. The changes look correct.)

**Confidence:** [1-5]/5 — [one sentence justification]

**Files reviewed:** [comma-separated list]"
\`\`\`

## Rules

- If you find NO issues, still post the summary comment with "No issues found"
- Do NOT post more than 5 inline comments — prioritize by impact
- Do NOT post style nitpicks or formatting comments
- The summary comment MUST start with \`<!-- claude-review -->\` on the first line
- Always post the summary comment, even if inline comments fail
- If \`gh api\` for inline comments fails (e.g. bad line number), post the findings in the summary comment instead
PROMPT

# Substitute PR number into the prompt (quoted heredoc prevents expansion)
sed -i '' "s/__PR_NUMBER__/${PR_NUMBER}/g" "$PROMPT_FILE"

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
PR_FILES=$(gh pr view "$PR_NUMBER" --json files --jq '.files[].path' 2>/dev/null || true)
NON_MD=$(printf '%s\n' "$PR_FILES" | grep -v '\.md$' || true)
PR_FILE_COUNT=$(printf '%s\n' "$PR_FILES" | grep -c . || true)
PR_CHANGED=$(gh pr view "$PR_NUMBER" --json changedFiles --jq '.changedFiles' 2>/dev/null || true)

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
# .css is in the pattern as well as .tsx: src/app/globals.css holds the @theme token
# block, and half the reject list is about tokens — a raw palette class where a token
# exists, a `dark:` override on a semantic token, arbitrary font sizes. A token-only
# PR changes no .tsx at all, so a .tsx-only pattern would hand the affirmative "no UI
# files" claim to the one diff shape the guide has most to say about (CLAUDE.md routes
# `@theme` and `--spacing-*` changes through docs/DESIGN.md for the same reason).
UI_FILES=$(printf '%s\n' "$PR_FILES" | grep -E '^src/(components|app)/.*\.(tsx|css)$' || true)

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

No file in this diff is a `.tsx` under `src/components/` or `src/app/`, so nothing here can violate the design guide. **Do not read `docs/DESIGN.md`** and do not raise design findings.

Record that in the Step 5 summary comment, on its own line directly above the `**Issues found:**` list, exactly:

**Design guide:** not applicable (no UI files)

`<!-- claude-review -->` must still be the very first line of the body, with nothing before it.
NO_DESIGN_PROMPT
fi

REVIEW_PROMPT=$(cat "$PROMPT_FILE")

# ─── Run the reviewer ─────────────────────────────────────────────────────────

echo -e "${GREEN}Starting Claude PR review for PR #${PR_NUMBER}${NC}"
echo -e "Model: ${MODEL}"
echo -e "Repository root: ${REPO_ROOT}"
echo "─────────────────────────────────────────"

cd "$REPO_ROOT"

# Unset ANTHROPIC_API_KEY so Claude CLI uses Max subscription instead of API credits
# Capture exit code manually since set -e would exit before our error message
EXIT_CODE=0
env -u ANTHROPIC_API_KEY claude -p \
  --dangerously-skip-permissions \
  --model "$MODEL" \
  "$REVIEW_PROMPT" || EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo -e "\n${GREEN}Review complete for PR #${PR_NUMBER}${NC}"
else
  echo -e "\n${RED}Review failed for PR #${PR_NUMBER} (exit code: ${EXIT_CODE})${NC}"
fi

exit $EXIT_CODE
