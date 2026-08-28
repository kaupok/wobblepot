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

# Verify PR exists
if ! gh pr view "$PR_NUMBER" --json number &> /dev/null; then
  echo -e "${RED}Error: PR #${PR_NUMBER} not found${NC}"
  exit 1
fi

# ─── Lock to prevent duplicate reviews ────────────────────────────────────────

LOCK_DIR="/tmp/claude-review-${PR_NUMBER}.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  # Check if the other instance already posted a review
  if gh api /repos/:owner/:repo/issues/${PR_NUMBER}/comments \
    --jq '[.[] | select(.body | startswith("<!-- claude-review -->"))] | length' 2>/dev/null | grep -q '^[1-9]'; then
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
gh pr view __PR_NUMBER__ --json title,body,files --jq '{title: .title, body: .body, files: [.files[].path]}'
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
