/**
 * The PR-body item in scripts/pr-review.sh (HON-860): the reviewer checks the PR
 * body's Verified / Not verified lists. Split from review-checklist-gate.test.ts.
 */
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { heredoc, prReview, read, repoRoot } from './review-checklist-gate.fixtures'

// HON-860: the PR body's Verified / Not verified lists are checked on every PR, so
// the heredoc must sit inside no gate but the PR-mode one (the local mode of HON-1404
// runs before a body exists), and before the prompt is read into REVIEW_PROMPT, or it
// would be written after the reviewer has its copy.
describe('PR body item', () => {
  it('is appended on every PR-mode run, before the prompt is read', () => {
    const lines = read(prReview).split('\n')
    const append = lines.indexOf(`  cat >> "$PROMPT_FILE" <<'PR_BODY_PROMPT'`)
    const snapshot = lines.findIndex((l) => l.startsWith('REVIEW_PROMPT=$(cat "$PROMPT_FILE")'))
    expect(append).toBeGreaterThan(-1)
    expect(append).toBeLessThan(snapshot)
    expect(lines[append - 1]).toBe('if [ "$MODE" = pr ]; then')
    // Every top-level `if` above the mode gate must be closed by its `fi`.
    const opened = lines
      .slice(0, append - 1)
      .reduce((depth, l) => (/^if /.test(l) ? depth + 1 : /^fi$/.test(l) ? depth - 1 : depth), 0)
    expect(opened).toBe(0)
  })

  it('names the three findings', () => {
    const body = heredoc('PR_BODY_PROMPT')
    expect(body).toContain('`- [ ]`')
    expect(body).toContain('"Verified" line that names no command, test, story or spec')
    expect(body).toContain('"Not verified" item whose failure would break')
  })

  // Body findings are summary-only by construction, so a "No issues found" beside one
  // passes /auto-implement 6.4's clean-review test and merges with the box open.
  it('forbids "No issues found" alongside a PR-body finding', () => {
    expect(heredoc('PR_BODY_PROMPT')).toContain('Do NOT write "No issues found"')
  })

  it('matches the headings the PR templates emit', () => {
    for (const skill of ['create-pr', 'auto-implement']) {
      const text = read(path.join(repoRoot, `.claude/skills/${skill}/SKILL.md`))
      expect(text, skill).toContain('## Verified')
      expect(text, skill).toContain('## Not verified')
      expect(text, skill).not.toContain('## Test plan')
    }
  })
})
