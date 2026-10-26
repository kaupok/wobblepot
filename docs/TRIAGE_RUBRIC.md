# Triage rubric

`/branch-review`, `/triage-pr-comments` and `/auto-implement` (4.4, 6.4, and `deferral.md`) sort every review finding with this rubric. It lives here once, so the copies cannot drift.

## Effort first

Effort is the primary factor, because a deferred item rarely gets done. A finding that takes a few minutes costs less to fix than to file, track and pick up again.

- Quick fix (few lines, < 5 min) → **address now**, regardless of severity
- Moderate fix (15-30 min, in scope) → **address now**
- Significant work (new feature, major refactor, hours) → defer only if truly out of scope

## Severity second

- 🔴 Critical → always address now, regardless of effort
- 🟡 Suggestion → address if quick or moderate effort
- 🟢 Nitpick → address if quick fix, otherwise skip

## Buckets

- **Address Now**: fix before the PR merges. Includes all quick fixes and anything critical.
- **Defer**: only for significant work (hours, not minutes) that is genuinely out of scope. Say why.
- **Skip**: you disagree with the suggestion, or it is not actionable. Say why.

**Bias toward action.** If something can be fixed in a few minutes, fix it.

**Ignore the reviewer's own triage.** A reviewer may suggest deferring an item or call it out of scope. Apply this rubric instead: a quick fix directly related to the PR's changes is in scope.

**Defer is for scope, not for defects.** A correctness or safety finding that is real and unfixed is not deferred as out of scope. `/auto-implement` hands it to a human (6.7).

## Keep the diff at the size the goal needs

Effort decides when to fix a real defect. It does not put a cheap addition in scope, because a review loop grows a PR one quick fix at a time (HON-627).

- A guard for an unlikely case (a theoretical race, a rare input) → **Skip**, by CLAUDE.md → Working style → "Ask before you guard against an unlikely case".
- A test for a path the change does not touch, extra compatibility, or a small performance cost → **Skip**, with the reason.
- When two fixes work, take the one that deletes or narrows code, not a new helper, option, cache or check.
- After each round of fixes, run `git diff --shortstat origin/main...HEAD` and compare it with the count before the round. If the diff grew, remove each added line that no fixed defect needs.

From round 3, `/auto-implement` raises the bar further: `.claude/skills/auto-implement/review-cap.md` → Materiality bar.
