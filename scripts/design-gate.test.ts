/**
 * The design-guide gate that decides whether a review reads docs/DESIGN.md (HON-615).
 *
 * docs/DESIGN.md is the guidance half of a loop: read before UI is built, checked
 * against after. The checking half lives in three review surfaces — /branch-review,
 * scripts/pr-review.sh, and /chrome-review — and all three of them are prose, so
 * nothing but a reader stops a rule from being dropped in an unrelated edit.
 *
 * Two things are worth executing rather than reading:
 *
 *   1. The `UI_FILES` grep in pr-review.sh. It decides, in shell rather than by
 *      model judgment, whether the design-guide instruction is appended at all.
 *      A regex that matched `src/lib/api.ts` would make every PR pay for the doc;
 *      one that missed `src/app/**` would silently disable the check on pages.
 *   2. That both branches emit their `**Design guide:**` summary line. That line is
 *      the only trace of the check on the PR page and the only thing a later audit
 *      can grep for, so losing it loses the feature without failing anything.
 *
 * Lives in scripts/ next to ci-settle-gate.test.ts, which executes shell snippets
 * from the skill files for the same reason.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const prReview = path.join(repoRoot, 'scripts/pr-review.sh')
const branchReviewSkill = path.join(repoRoot, '.claude/skills/branch-review/SKILL.md')
const chromeReviewSkill = path.join(repoRoot, '.claude/skills/chrome-review/SKILL.md')
const designGuide = path.join(repoRoot, 'docs/DESIGN.md')

const read = (file: string) => fs.readFileSync(file, 'utf8')

/** The two summary lines that make the check observable from the PR page. */
const CHECKED_LINE = '**Design guide:** checked against docs/DESIGN.md — N findings'
const NOT_APPLICABLE_LINE = '**Design guide:** not applicable (no UI files)'

/**
 * The `UI_FILES=` assignment lifted verbatim out of pr-review.sh, so the test can
 * only ever agree with the shipped gate. Extracting it beats duplicating the regex:
 * a copy would keep passing after the real one was edited.
 */
function uiFilesAssignment(): string {
  return lineStartingWith('UI_FILES=', 'assigns UI_FILES')
}

/**
 * Which prompt branch the gate takes, given a file list and the `changedFiles` total
 * `gh` reported for the PR. Every line of the decision is lifted from the script, so
 * the branch this returns is the branch the reviewer actually gets.
 */
function branchFor(files: string[], changedFiles: string): 'design' | 'no-design' {
  const condition = lineStartingWith('if [ -n "$UI_FILES" ]', 'branches on UI_FILES')
    .replace(/^if\s+/, '')
    .replace(/;\s*then\s*$/, '')

  const script = [
    'set -euo pipefail',
    'PR_FILES=$(cat)',
    lineStartingWith('PR_FILE_COUNT=', 'counts the returned paths'),
    `PR_CHANGED=${JSON.stringify(changedFiles)}`,
    completenessBlock(),
    uiFilesAssignment(),
    `if ${condition}; then echo design; else echo no-design; fi`,
  ].join('\n')

  const branch = execFileSync('bash', ['-c', script], {
    input: files.join('\n'),
    encoding: 'utf8',
  }).trim()
  if (branch !== 'design' && branch !== 'no-design') throw new Error(`unexpected branch: ${branch}`)
  return branch
}

/**
 * The body of one appended heredoc, bounded at its terminator.
 *
 * Bounding matters: an unbounded `split()` runs to EOF, so an assertion aimed at the
 * DESIGN_PROMPT block is satisfied by NO_DESIGN_PROMPT further down and stops biting
 * on the branch it names. `<<'DESIGN_PROMPT'` cannot match `<<'NO_DESIGN_PROMPT'`,
 * and neither can the `\nDESIGN_PROMPT\n` terminator, so the two stay distinct.
 */
function heredoc(name: string): string {
  const source = read(prReview)
  const start = source.indexOf(`<<'${name}'`)
  if (start === -1) throw new Error(`scripts/pr-review.sh no longer appends ${name}`)
  const end = source.indexOf(`\n${name}\n`, start + 1)
  if (end === -1) throw new Error(`${name} heredoc is unterminated`)
  return source.slice(start, end)
}

/** One shell line lifted from the script, matched by how it starts. */
function lineStartingWith(prefix: string, what: string): string {
  const line = read(prReview)
    .split('\n')
    .find((l) => l.startsWith(prefix))
  if (!line) throw new Error(`scripts/pr-review.sh no longer ${what}`)
  return line
}

/** The `PR_FILES_COMPLETE` if/else, lifted verbatim. */
function completenessBlock(): string {
  const lines = read(prReview).split('\n')
  const start = lines.findIndex((l) => l.startsWith('if [ -n "$PR_FILES" ] && [ "$PR_FILE_COUNT"'))
  if (start === -1) throw new Error('scripts/pr-review.sh no longer derives PR_FILES_COMPLETE')
  const end = lines.indexOf('fi', start)
  if (end === -1) throw new Error('the PR_FILES_COMPLETE block is unterminated')
  return lines.slice(start, end + 1).join('\n')
}

/** Run the extracted gate over a file list and return the paths it classified as UI. */
function classify(files: string[]): string[] {
  const script = [
    // The real script's flags, so `set -e` can actually abort on grep's exit 1 —
    // otherwise the no-match test below passes whether or not `|| true` is there.
    'set -euo pipefail',
    'PR_FILES=$(cat)',
    uiFilesAssignment(),
    'printf %s "$UI_FILES"',
  ].join('\n')

  return execFileSync('bash', ['-c', script], { input: files.join('\n'), encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
}

describe('design-guide gate', () => {
  describe('UI_FILES classification (scripts/pr-review.sh)', () => {
    it('selects .tsx under src/components and src/app', () => {
      const ui = [
        'src/components/ui/button.tsx',
        'src/components/meal-plan/MealDetailModal.tsx',
        'src/app/page.tsx',
        'src/app/shopping-list/loading.tsx',
      ]
      expect(classify(ui)).toEqual(ui)
    })

    // The two directories are the whole gate, so the fixture has to contain a .tsx
    // outside them: without one, widening the regex to `^src/.*\.tsx$` passes every
    // assertion here while making each non-UI PR read a document it cannot violate.
    it('selects no .tsx outside src/components and src/app', () => {
      expect(
        classify([
          'src/lib/auth-errors-client.tsx',
          'src/lib/i18n/plurals.test.tsx',
          '.storybook/preview.tsx',
          '.claude/templates/component.tsx',
        ]),
      ).toEqual([])
    })

    // Everything else the design guide cannot speak to. The route handler is the
    // near miss: it lives under a gated directory but renders no UI, so the .tsx
    // extension — not the directory alone — is what has to decide.
    it('selects no non-tsx file, including under a gated directory', () => {
      expect(
        classify([
          'src/app/api/meals/route.ts',
          'src/app/globals.css',
          'src/components/meal-plan/use-meal-swap.ts',
          'src/stories/design-rules.ts',
          'docs/DESIGN.md',
          '.claude/skills/branch-review/SKILL.md',
          'scripts/pr-review.sh',
          'prisma/schema.prisma',
        ]),
      ).toEqual([])
    })

    // A test and a story under a gated directory do gate in. That is deliberate and
    // cheap: they render the same components, and excluding them would need a second
    // pattern that a renamed suffix could then silently escape.
    it('includes tests and stories that live under a gated directory', () => {
      const colocated = [
        'src/components/ui/button.test.tsx',
        'src/components/ui/button.stories.tsx',
      ]
      expect(classify(colocated)).toEqual(colocated)
    })

    // The branch this PR itself takes, and the one the whole gate exists for: a
    // docs/skill-only diff must not make the reviewer open docs/DESIGN.md.
    it('classifies a docs-and-skills diff as no-UI', () => {
      expect(
        classify([
          'docs/DESIGN.md',
          '.claude/skills/chrome-review/SKILL.md',
          'scripts/pr-review.sh',
          'scripts/design-gate.test.ts',
        ]),
      ).toEqual([])
    })

    // `grep` exits 1 when nothing matches and the script runs under `set -e` with
    // pipefail; without the `|| true` the reviewer would die before it ever ran.
    it('survives a no-match without failing the script', () => {
      expect(() => classify(['docs/DESIGN.md'])).not.toThrow()
      expect(uiFilesAssignment()).toContain('|| true')
    })
  })

  // The `else` branch does not skip the check, it asserts `not applicable (no UI
  // files)` into the summary comment. That claim rests entirely on PR_FILES, which
  // is empty on any `gh pr view` failure and capped at 100 paths (HON-587) — so the
  // gate has to establish the list was readable and complete before making it.
  describe('branch selection fails closed on an untrustworthy file list', () => {
    const docsOnly = ['docs/DESIGN.md', 'scripts/pr-review.sh']

    it('claims not-applicable only from a complete list with no UI files', () => {
      expect(branchFor(docsOnly, String(docsOnly.length))).toBe('no-design')
    })

    it('checks the guide when the file list came back empty', () => {
      // `gh pr view` failed: PR_FILES is empty, so UI_FILES is empty too, and the
      // pre-fix gate would have posted "not applicable" for a PR it never read.
      expect(branchFor([], '30')).toBe('design')
    })

    it('checks the guide when the file list was truncated', () => {
      // The HON-587 shape: 100 paths returned, 150 changed, and the UI files are in
      // the 50 that never arrived.
      expect(branchFor(docsOnly, '150')).toBe('design')
    })

    it('checks the guide when changedFiles could not be read', () => {
      // `PR_CHANGED` is empty, which cannot equal any count — the same fail-closed
      // move the prose gate above already makes.
      expect(branchFor(docsOnly, '')).toBe('design')
    })

    it('checks the guide whenever UI files are present', () => {
      const ui = ['src/components/ui/button.tsx', 'docs/DESIGN.md']
      expect(branchFor(ui, String(ui.length))).toBe('design')
    })
  })

  describe('both prompt branches are present and observable', () => {
    it('appends the design instruction only when UI_FILES is non-empty', () => {
      const source = read(prReview)
      expect(source).toContain('if [ -n "$UI_FILES" ]; then')
      expect(source).toContain("<<'DESIGN_PROMPT'")
      expect(source).toContain("<<'NO_DESIGN_PROMPT'")
    })

    it('emits a Design guide summary line on both branches', () => {
      const source = read(prReview)
      expect(source).toContain(CHECKED_LINE)
      expect(source).toContain(NOT_APPLICABLE_LINE)
    })

    // The no-UI branch is what the AC verifies in-PR: the run log must show the
    // guide was never opened, which only holds if the prompt says so outright.
    it('tells the reviewer not to read the guide on the no-UI branch', () => {
      expect(heredoc('NO_DESIGN_PROMPT')).toContain('Do not read `docs/DESIGN.md`')
    })

    // Both appended blocks instruct a line in the summary comment, and the marker
    // has to survive both. A block that pushed content above it would make the
    // whole round invisible to the automation that locates reviews by that prefix.
    it('reasserts on each branch that the claude-review marker stays the first line', () => {
      for (const name of ['DESIGN_PROMPT', 'NO_DESIGN_PROMPT']) {
        expect(heredoc(name), name).toContain('<!-- claude-review -->')
        expect(heredoc(name), name).toContain('very first line')
      }
    })

    // The twice-seen-pattern exception is summary-only and explicitly not inline,
    // which is the exact shape /auto-implement 6.6 reads as a clean review and
    // merges on. PROSE_PROMPT carries the same guard for its own summary-only
    // verdict; without it the feedback half of the loop is dropped on every
    // auto-merged UI PR.
    it('forbids "No issues found" alongside a proposed reject-list entry', () => {
      const designBranch = heredoc('DESIGN_PROMPT')
      expect(designBranch).toContain('**Issues found:**')
      expect(designBranch).toMatch(/do NOT write "No issues found"/i)
    })
  })

  describe('the skill surfaces carry the gate and the named-item rule', () => {
    it('/branch-review gates on UI files and requires a named item', () => {
      const source = read(branchReviewSkill)
      expect(source).toContain('src/components/**/*.tsx')
      expect(source).toContain('Reject list')
      expect(source).toContain('Composition rules')
      expect(source).toMatch(/Anything the document does not name is taste/)
    })

    it('/branch-review reports the check in its Context block', () => {
      expect(read(branchReviewSkill)).toContain(
        '- **Design guide**: checked against `docs/DESIGN.md` / not applicable (no UI files)',
      )
    })

    it('/chrome-review reads the guide and names the item it matches', () => {
      const source = read(chromeReviewSkill)
      expect(source).toContain('Read docs/DESIGN.md')
      expect(source).toMatch(/Name the item when you present it/)
    })

    // The feedback half of the loop: a pattern the guide does not name yet is a
    // proposed reject-list line, not a dropped observation.
    it('both skills route an unnamed repeated pattern back into the reject list', () => {
      expect(read(branchReviewSkill)).toMatch(/proposing it as a new reject-list entry/)
      expect(read(chromeReviewSkill)).toMatch(/a one-line addition to the \*\*Reject list\*\*/)
    })
  })

  describe('docs/DESIGN.md states the review scope', () => {
    it('scopes reviews to the reject list and composition rules', () => {
      expect(read(designGuide)).toMatch(
        /Reviews check against the \[Reject list\]\(#reject-list\) and \[Composition rules\]\(#composition-rules\) only/,
      )
    })

    // The two sections the gate points every reviewer at have to exist under the
    // anchors used above, or every design finding cites a dangling reference.
    it('still has the two sections the reviews check against', () => {
      const source = read(designGuide)
      expect(source).toMatch(/^## Composition rules$/m)
      expect(source).toMatch(/^## Reject list$/m)
    })
  })
})
