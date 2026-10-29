/**
 * /auto-implement Phase 6 runs the PR review while CI runs (HON-1406).
 *
 * The review reads the diff, the code and the issue, not the CI result. Phase 6
 * used to wait for CI first, so the review's median 1.4 min added to every round.
 * Each round now reviews (6.3) and triages (6.4) before the CI wait (6.5), and
 * one 6.5 pass fixes both the review findings and the CI failures. Below round 3
 * every push, a CI-fix push included, goes back to review, so 7.2 never merges
 * a commit that no review saw.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const skill = fs.readFileSync(path.join(repoRoot, '.claude/skills/auto-implement/SKILL.md'), 'utf8')

/** The text from one heading up to the next heading named `end`. */
function section(start: string, end: string): string {
  const from = skill.indexOf(start)
  const to = skill.indexOf(end, from + start.length)
  expect(from, `heading "${start}" not found`).toBeGreaterThanOrEqual(0)
  expect(to, `heading "${end}" not found after "${start}"`).toBeGreaterThan(from)
  return skill.slice(from, to)
}

describe('auto-implement Phase 6 order', () => {
  it('runs the review before the CI wait', () => {
    const phase6 = section('## Phase 6', '## Phase 7')
    const review = phase6.indexOf('./scripts/pr-review.sh')
    const wait = phase6.indexOf('./scripts/ci-settle.sh')
    expect(review).toBeGreaterThan(-1)
    expect(wait).toBeGreaterThan(review)
  })

  it('fixes the review findings and the CI failures in one 6.5 pass', () => {
    const pass = section('### 6.5 Wait for CI', '### 6.6')
    expect(pass).toContain("**One fix pass** takes this round's Address Now items and CI failures.")
  })

  it('sends every push below round 3 back to review, a CI fix included', () => {
    const decide = section('### 6.6', '### 6.7')
    expect(decide).toContain('- **A. `ROUND` < 3, pushed** (review fixes, CI fixes, or both) →')
    expect(decide).toContain('back to 6.2.')
  })
})
