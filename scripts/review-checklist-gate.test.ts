/**
 * The E2E-drift and shared-geometry checklist items in scripts/pr-review.sh (HON-729).
 *
 * Both CLAUDE.md rules are prose with no mechanical check, so the reviewer prompt is
 * their only enforcement — and it is appended conditionally, by a shell grep over the
 * PR's file list. A regex that stopped matching `src/app/**` or `globals.css` would
 * silently switch the check off; one that matched everything would make every PR pay
 * for it. Same approach as design-gate.test.ts: lift the shipped lines verbatim and
 * execute them, so the test can only ever agree with the script.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const prReview = path.join(repoRoot, 'scripts/pr-review.sh')
const planIssueSkill = path.join(repoRoot, '.claude/skills/plan-issue/SKILL.md')

const read = (file: string) => fs.readFileSync(file, 'utf8')

/** One shell line lifted from the script, matched by how it starts. */
function lineStartingWith(prefix: string): string {
  const line = read(prReview)
    .split('\n')
    .find((l) => l.startsWith(prefix))
  if (!line) throw new Error(`scripts/pr-review.sh no longer has a line starting ${prefix}`)
  return line
}

/** The body of one appended heredoc, bounded at its terminator. */
function heredoc(name: string): string {
  const source = read(prReview)
  const start = source.indexOf(`<<'${name}'`)
  if (start === -1) throw new Error(`scripts/pr-review.sh no longer appends ${name}`)
  const end = source.indexOf(`\n${name}\n`, start + 1)
  if (end === -1) throw new Error(`${name} heredoc is unterminated`)
  return source.slice(start, end)
}

/** Run one extracted gate assignment over a file list and return what it selected. */
function classify(variable: 'E2E_FILES' | 'GEOMETRY_FILES', files: string[]): string[] {
  const script = [
    // The real script's flags, so `set -e` aborts on grep's exit 1 if `|| true` goes.
    'set -euo pipefail',
    'PR_FILES=$(cat)',
    lineStartingWith(`${variable}=`),
    `printf %s "$${variable}"`,
  ].join('\n')

  return execFileSync('bash', ['-c', script], { input: files.join('\n'), encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
}

const UNRELATED = [
  'src/app/api/meals/route.ts',
  'src/lib/utils.ts',
  'docs/DESIGN.md',
  'scripts/pr-review.sh',
  'prisma/schema.prisma',
  'tests/e2e/auth.spec.ts',
]

describe('E2E-drift gate', () => {
  it('selects pages, components and the copy catalogs', () => {
    const hits = [
      'src/app/profile/page.tsx',
      'src/app/meal-plan/MealPlanClient.tsx',
      'src/components/Header.tsx',
      'src/components/meal-plan/MealDetailModal.tsx',
      'messages/en.json',
      'messages/et.json',
    ]
    expect(classify('E2E_FILES', hits)).toEqual(hits)
  })

  // No spec can drift from a story or a unit test, so a story-only PR must not
  // make the reviewer grep tests/e2e.
  it('skips stories and unit tests, and anything outside the gated paths', () => {
    expect(
      classify('E2E_FILES', [
        'src/components/Header.stories.tsx',
        'src/components/Header.test.tsx',
        'src/app/page.test.tsx',
        ...UNRELATED,
      ]),
    ).toEqual([])
  })

  it('survives a no-match without failing the script', () => {
    expect(() => classify('E2E_FILES', ['docs/DESIGN.md'])).not.toThrow()
  })
})

describe('shared-geometry gate', () => {
  it('selects primitives and the token stylesheet', () => {
    const hits = ['src/components/ui/button.tsx', 'src/app/globals.css']
    expect(classify('GEOMETRY_FILES', hits)).toEqual(hits)
  })

  // Feature components and pages consume the primitives, they do not define their
  // defaults, so they are the callsites the check greps — not what triggers it.
  it('skips feature components, pages, stories and tests', () => {
    expect(
      classify('GEOMETRY_FILES', [
        'src/components/Header.tsx',
        'src/components/ui/button.stories.tsx',
        'src/components/ui/button.test.tsx',
        'src/app/shopping-list/loading.tsx',
        ...UNRELATED,
      ]),
    ).toEqual([])
  })

  it('survives a no-match without failing the script', () => {
    expect(() => classify('GEOMETRY_FILES', ['docs/DESIGN.md'])).not.toThrow()
  })
})

describe('prompt items', () => {
  // Fail closed like the design gate: an unreadable or truncated list must not
  // silently drop the only enforcement these rules have.
  it.each([
    ['E2E_FILES', 'E2E_PROMPT'],
    ['GEOMETRY_FILES', 'GEOMETRY_PROMPT'],
  ])('appends %s item on a match or an untrustworthy file list', (variable, name) => {
    expect(read(prReview)).toContain(
      `if [ -n "$${variable}" ] || [ "$PR_FILES_COMPLETE" = false ]; then`,
    )
    expect(heredoc(name)).toContain('this check has nothing to do')
  })

  it('points the E2E item at the spec-header grep', () => {
    expect(heredoc('E2E_PROMPT')).toContain('tests/e2e/*.spec.ts')
    expect(heredoc('E2E_PROMPT')).toContain('ROUTES.*<route>')
  })

  // The geometry item delegates its greps to /plan-issue step 7b rather than copying
  // them, so that step has to keep existing under that name and keep the Mirror bucket.
  it('points the geometry item at a /plan-issue step that still exists', () => {
    expect(heredoc('GEOMETRY_PROMPT')).toContain('.claude/skills/plan-issue/SKILL.md` step 7b')
    expect(read(planIssueSkill)).toMatch(/^#### 7b\. Shared-primitive coupling$/m)
    expect(read(planIssueSkill)).toContain('**Mirror**')
  })
})
