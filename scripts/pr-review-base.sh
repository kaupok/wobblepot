# shellcheck shell=bash
# The base review prompt for scripts/pr-review.sh: the task, the quality bar and
# the five steps. Sourced, never executed.
#
# Two modes share it (HON-1404). `pr` reads the diff with `gh` and posts to the PR.
# `local` reads the branch's diff with `git` before a PR exists and prints the
# summary, which pr-review.sh writes to a file. Only the task line and steps 1, 4
# and 5 differ; the criteria, steps 2-3 and the summary format are one copy each,
# so the two reviews cannot drift apart. scripts/pr-review-local.test.ts runs both
# modes and compares the prompts.
#
# write_base_prompt <prompt-file> <pr|local>
# Writes the prompt with `__PR_NUMBER__`, `__ISSUE_ID__` and `__BASE__` left for
# the caller to substitute.
write_base_prompt() {
  local file="$1" mode="$2"

  if [ "$mode" = local ]; then
    cat > "$file" <<'LOCAL_TASK'
You are reviewing the local changes for Linear issue __ISSUE_ID__ in the Honkadori project, before its PR opens. You are a fresh reviewer with NO context from the implementation — you only see the diff and the codebase.

No PR exists yet, so there is no PR body and nothing to post to. Where a check below takes evidence from the PR body, judge it from the diff alone, and word the finding so the implementer can add the evidence: a test, a committed report, or a PR body line.

## Your task

1. Get the diff and understand what changed
2. Read the changed files IN FULL (not just the diff lines) for surrounding context
3. Explore related code — callers, schema, API routes, similar patterns
4. Find real bugs and print them in the summary
LOCAL_TASK
  else
    cat > "$file" <<'PR_TASK'
You are reviewing PR #__PR_NUMBER__ in the Honkadori project. You are a fresh reviewer with NO context from the implementation — you only see the final diff and the codebase.

## Your task

1. Get the PR diff and understand what changed
2. Read the changed files IN FULL (not just the diff lines) for surrounding context
3. Explore related code — callers, schema, API routes, similar patterns
4. Find real bugs and post findings to GitHub
PR_TASK
  fi

  cat >> "$file" <<'REVIEW_CRITERIA'

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
REVIEW_CRITERIA

  if [ "$mode" = local ]; then
    cat >> "$file" <<'LOCAL_STEP_1'
\`\`\`bash
# Every change since the branch left origin/main: commits, staged and unstaged edits.
git diff __BASE__
# New files not yet added to git. Read each one in full as an added file.
git ls-files --others --exclude-standard
\`\`\`
LOCAL_STEP_1
  else
    cat >> "$file" <<'PR_STEP_1'
\`\`\`bash
gh pr diff __PR_NUMBER__
gh pr view __PR_NUMBER__ --json title,body --jq '{title: .title, body: .body}'
# The file list comes from the paginated REST endpoint, NOT `--json files`: that
# caps at 100 and cannot paginate (HON-587), so on a large PR you would silently
# review the first 100 paths and report "no issues found" on the rest unseen.
gh api --paginate "/repos/:owner/:repo/pulls/__PR_NUMBER__/files?per_page=100" | jq -rs 'add | .[].filename'
\`\`\`
PR_STEP_1
  fi

  cat >> "$file" <<'REVIEW_READ_STEPS'

### Step 2: Read changed files in full

For each changed file, read the COMPLETE file (not just the diff) to understand the full context. This is critical for finding cross-file bugs.

### Step 3: Explore related code

For each significant change, use Grep and Read to find:
- Where changed functions/components are called from
- Related Prisma models in prisma/schema.prisma
- API routes that consume or produce the affected data
- Other files with similar patterns that might have the same bug
REVIEW_READ_STEPS

  if [ "$mode" = local ]; then
    cat >> "$file" <<'LOCAL_STEPS_4_5'

### Step 4: Collect the findings

Do NOT post anything to GitHub, and do not run `gh`: there is no PR yet. Put every finding in the summary's `**Issues found:**` list, the ones inside the diff as well as the ones outside it. Give each its file:line and all four parts of the quality bar above, with a fenced code block for the fix when you have one.

### Step 5: Print the summary

Your final answer is the summary below and nothing else, without the code fence around it: the caller writes it to a file and reads it. Its very first line MUST be `<!-- claude-review -->`, with nothing before it.
LOCAL_STEPS_4_5
  else
    cat >> "$file" <<'PR_STEPS_4_5'

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

Post an issue-level summary comment. This MUST start with the HTML marker on the very first line. Write the body below to a file, then post it; `-F body=@<file>` reads the field from the file:

\`\`\`bash
gh api /repos/{owner}/{repo}/issues/__PR_NUMBER__/comments --method POST -F body=@<file>
\`\`\`

The body is the lines inside this fence:
PR_STEPS_4_5
  fi

  cat >> "$file" <<'SUMMARY_FORMAT'

\`\`\`markdown
<!-- claude-review -->
### Claude review

[2-3 sentence summary of what the change does and your overall assessment]

**Issues found:**
1. **[Issue title]** (file:line) — [one sentence]
2. ...

(If no issues: No issues found. The changes look correct.)

**Confidence:** [1-5]/5 — [one sentence justification]

**Files reviewed:** [comma-separated list]
\`\`\`
SUMMARY_FORMAT

  if [ "$mode" = local ]; then
    cat >> "$file" <<'LOCAL_RULES'

## Rules

- If you find NO issues, still print the summary with "No issues found"
- Do NOT report style nitpicks or formatting
- Your final answer MUST start with \`<!-- claude-review -->\` on the first line
LOCAL_RULES
  else
    cat >> "$file" <<'PR_RULES'

## Rules

- If you find NO issues, still post the summary comment with "No issues found"
- Do NOT post more than 5 inline comments — prioritize by impact
- Do NOT post style nitpicks or formatting comments
- The summary comment MUST start with \`<!-- claude-review -->\` on the first line
- Always post the summary comment, even if inline comments fail
- If \`gh api\` for inline comments fails (e.g. bad line number), post the findings in the summary comment instead
PR_RULES
  fi
}
