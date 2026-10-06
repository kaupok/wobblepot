/**
 * The E2E-drift and shared-geometry checklist items in scripts/pr-review.sh (HON-729),
 * and the AI eval report item (HON-904).
 *
 * All three rules are prose with no mechanical check, so the reviewer prompt is
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
function classify(
  variable: 'E2E_FILES' | 'GEOMETRY_FILES' | 'AI_EVAL_FILES',
  files: string[],
): string[] {
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
  it('selects pages, components, the copy catalogs and the proxy', () => {
    const hits = [
      'src/app/profile/page.tsx',
      'src/app/meal-plan/MealPlanClient.tsx',
      'src/components/Header.tsx',
      'src/components/meal-plan/MealDetailModal.tsx',
      'messages/en.json',
      'messages/et.json',
      // Owns the redirects tests/e2e/auth-redirect.spec.ts asserts on.
      'src/proxy.ts',
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

describe('AI eval gate', () => {
  it('selects models, budgets, request builders, the text they send, and committed cases', () => {
    const hits = [
      'src/lib/ai/models.ts',
      'src/lib/ai/budgets.ts',
      'src/lib/ai/prompts.ts',
      'src/lib/ai/recipe-prompt.ts',
      'src/lib/ai/recipe-schema.ts',
      'src/lib/ai/types.ts',
      'src/lib/ai/imagine-request.ts',
      'src/lib/ai/review-request.ts',
      'src/lib/ai/preparation-steps.ts',
      'src/lib/ai/cook-question.ts',
      'src/lib/vague-quantities.ts',
      'scripts/model-bench/cases/imagine/en-pasta-for-two.json',
    ]
    expect(classify('AI_EVAL_FILES', hits)).toEqual(hits)
  })

  // Drafts are gitignored and never loaded, and the README is prose, so neither
  // changes what the eval measures.
  it('skips tests, drafts, the cases README and the rest of src/lib/ai', () => {
    expect(
      classify('AI_EVAL_FILES', [
        'src/lib/ai/models.test.ts',
        'src/lib/ai/recipe-schema.test.ts',
        'src/lib/vague-quantities.test.ts',
        'scripts/model-bench/cases/imagine/x.draft.json',
        'scripts/model-bench/cases/README.md',
        'src/lib/ai/pricing.ts',
        'src/lib/ai/imagine-meal.ts',
        'src/lib/ai/cook-question-limits.ts',
        'src/components/meal-plan/MealCard.tsx',
        ...UNRELATED,
      ]),
    ).toEqual([])
  })

  it('survives a no-match without failing the script', () => {
    expect(() => classify('AI_EVAL_FILES', ['docs/DESIGN.md'])).not.toThrow()
  })

  // The gate fires on these files, so the item must name them, or its "nothing to
  // do" clause lets a schema-only or phrase-list-only change through.
  it('names every kind of file the gate fires on, and the run each needs', () => {
    const body = heredoc('AI_EVAL_PROMPT')
    for (const file of ['recipe-schema.ts', 'types.ts', 'vague-quantities.ts', 'models.ts']) {
      expect(body).toContain(file)
    }
    expect(body).toContain('scripts/model-bench/results/')
    expect(body).toContain('`--check` report')
    expect(body).toContain('`--baseline golden` comparison')
    // A golden recorded on the branch compares the new prompt with itself.
    expect(body).toContain('scripts/model-bench/golden/')
  })
})

describe('prompt items', () => {
  // Fail closed like the design gate: an unreadable or truncated list must not
  // silently drop the only enforcement these rules have.
  it.each([
    ['E2E_FILES', 'E2E_PROMPT'],
    ['GEOMETRY_FILES', 'GEOMETRY_PROMPT'],
    ['AI_EVAL_FILES', 'AI_EVAL_PROMPT'],
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

// HON-860: the PR body's Verified / Not verified lists are checked on every PR, so
// the heredoc must sit at top level (not inside a gate's `if`) and before the prompt
// is read into REVIEW_PROMPT, or it would be written after the reviewer has its copy.
describe('PR body item', () => {
  it('is appended unconditionally, before the prompt is read', () => {
    const lines = read(prReview).split('\n')
    const append = lines.indexOf(`cat >> "$PROMPT_FILE" <<'PR_BODY_PROMPT'`)
    const snapshot = lines.findIndex((l) => l.startsWith('REVIEW_PROMPT=$(cat "$PROMPT_FILE")'))
    expect(append).toBeGreaterThan(-1)
    expect(append).toBeLessThan(snapshot)
    // Every top-level `if` above the append must be closed by its `fi`.
    const opened = lines
      .slice(0, append)
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
