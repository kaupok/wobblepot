/**
 * The destructive-migration check behind `ci.yml`'s `destructive-migrations`
 * job and `deploy-production.yml`'s `destructive-check` job (HON-1512).
 *
 * Neither workflow runs on a PR that changes them in a way a test sees, so
 * these tests call the exported functions: SQL in, findings out, and for the
 * deploy gate a stubbed `gh` and `git` in, a held or passed run out.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  checkMigrationDirs,
  checkSql,
  deployGate,
  LABEL,
  type Run,
  splitStatements,
  summaryMarkdown,
} from './check-destructive-migrations'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrations = path.join(root, 'prisma/migrations')
const DROP_FOOD_COLUMNS = path.join(
  migrations,
  '20261026150000_drop_member_preferences_food_columns',
)
const ADD_NOTE = path.join(migrations, '20260128122509_add_note_to_meal_plan_entry')

/** The pattern names one statement of SQL matches. */
const flagged = (sql: string) => checkSql('m', sql).flatMap((finding) => finding.patterns)

describe('checkSql', () => {
  it.each([
    ['DROP TABLE "recipes";', 'DROP TABLE'],
    ['ALTER TABLE "recipes" DROP COLUMN "note";', 'DROP COLUMN'],
    ['DROP TYPE "DietaryType_old";', 'DROP TYPE'],
    ['TRUNCATE "sessions";', 'TRUNCATE'],
    ['DELETE FROM "ingredients" WHERE "id" = 1;', 'DELETE FROM'],
    ['UPDATE "recipes" SET "servings" = 4 WHERE "servings" IS NULL;', 'UPDATE … SET'],
    ['ALTER TABLE "recipes" ALTER COLUMN "servings" TYPE DOUBLE PRECISION;', 'ALTER COLUMN … TYPE'],
    ['ALTER TABLE "recipes" ALTER COLUMN "servings" SET DATA TYPE TEXT;', 'ALTER COLUMN … TYPE'],
    ['ALTER TABLE "recipes" RENAME COLUMN "name" TO "title";', 'RENAME'],
    ['ALTER TYPE "DietaryType" RENAME TO "DietaryType_old";', 'RENAME'],
  ])('flags %s', (sql, pattern) => {
    expect(flagged(sql)).toEqual([pattern])
  })

  it('matches case-insensitively', () => {
    expect(flagged('drop table recipes;')).toEqual(['DROP TABLE'])
    expect(flagged('update recipes set servings = 4;')).toEqual(['UPDATE … SET'])
  })

  it.each([
    ['DROP INDEX "recipes_name_idx";'],
    ['CREATE TABLE "notes" ("id" TEXT NOT NULL, CONSTRAINT "notes_pkey" PRIMARY KEY ("id"));'],
    ['CREATE INDEX "notes_id_idx" ON "notes"("id");'],
    ['ALTER TABLE "recipes" ADD COLUMN "note" TEXT;'],
    [
      'ALTER TABLE "notes" ADD CONSTRAINT "notes_recipe_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE SET NULL ON UPDATE CASCADE;',
    ],
    [
      'ALTER TABLE "notes" ADD CONSTRAINT "notes_owner_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE SET NULL;',
    ],
    ['ALTER TABLE "recipes" ALTER COLUMN "servings" SET DEFAULT 4;'],
  ])('does not flag %s', (sql) => {
    expect(checkSql('m', sql)).toEqual([])
  })

  it('ignores a commented-out statement', () => {
    expect(checkSql('m', '-- DROP TABLE "recipes";\nCREATE INDEX "a" ON "b"("c");')).toEqual([])
    expect(
      checkSql('m', '/* DELETE FROM "recipes"; */ ALTER TABLE "x" ADD COLUMN "y" TEXT;'),
    ).toEqual([])
    expect(checkSql('m', '/* outer /* nested */ TRUNCATE "x"; */ SELECT 1;')).toEqual([])
  })

  it('ignores keywords inside string literals and quoted identifiers', () => {
    expect(
      checkSql('m', `INSERT INTO "tips" ("text") VALUES ('Never DROP TABLE; it''s rude');`),
    ).toEqual([])
    expect(checkSql('m', 'ALTER TABLE "x" ADD COLUMN "rename" TEXT;')).toEqual([])
  })

  it('checks the statements inside a dollar-quoted block', () => {
    const sql = 'DO $$ BEGIN UPDATE "x" SET "y" = 1; DELETE FROM "z"; END $$;'
    expect(checkSql('m', sql)).toEqual([
      { migration: 'm', statement: sql.slice(0, -1), patterns: ['DELETE FROM', 'UPDATE … SET'] },
    ])
  })

  it('reports one finding per statement and names the migration', () => {
    const findings = checkSql(
      '20260101000000_x',
      'DROP TABLE "a"; CREATE TABLE "b" ("c" TEXT); TRUNCATE "d";',
    )
    expect(findings).toEqual([
      { migration: '20260101000000_x', statement: 'DROP TABLE "a"', patterns: ['DROP TABLE'] },
      { migration: '20260101000000_x', statement: 'TRUNCATE "d"', patterns: ['TRUNCATE'] },
    ])
  })

  it('shortens a long statement in the report', () => {
    const statements = checkSql('m', `DROP TABLE "${'a'.repeat(300)}";`).map((f) => f.statement)
    expect(statements).toHaveLength(1)
    expect(statements[0]).toHaveLength(160)
    expect(statements[0]?.endsWith('…')).toBe(true)
  })
})

describe('splitStatements', () => {
  it('splits on semicolons outside quotes and drops comments', () => {
    expect(
      splitStatements("-- header\nSELECT ';'; /* c */ SELECT 2;\n").map((s) => s.text),
    ).toEqual(["SELECT ';'", 'SELECT 2'])
  })
})

describe('checkMigrationDirs on real migrations', () => {
  it('flags the HON-1327 drop of the member food columns', () => {
    const findings = checkMigrationDirs([DROP_FOOD_COLUMNS])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.migration).toBe('20261026150000_drop_member_preferences_food_columns')
    expect(findings[0]?.patterns).toEqual(['DROP COLUMN'])
    expect(
      findings[0]?.statement.startsWith(
        'ALTER TABLE "member_preferences" DROP COLUMN "targetCalories"',
      ),
    ).toBe(true)
  })

  it('does not flag an additive migration', () => {
    expect(checkMigrationDirs([ADD_NOTE])).toEqual([])
  })
})

describe('summaryMarkdown', () => {
  it('lists each finding with its migration and patterns', () => {
    const markdown = summaryMarkdown(
      [{ migration: '20260101000000_x', statement: 'DROP TABLE "a"', patterns: ['DROP TABLE'] }],
      'Intro.',
    )
    expect(markdown).toBe(
      '### Destructive migration statements\n\nIntro.\n\n- `20260101000000_x`: DROP TABLE — `DROP TABLE "a"`\n',
    )
  })
})

describe('deployGate', () => {
  const REPO = 'kaupok/wobblepot'
  const LIVE = 'a'.repeat(40)
  const TARGET = 'b'.repeat(40)
  const DROP = 'prisma/migrations/20261101000000_drop_x/migration.sql'
  const ADD = 'prisma/migrations/20261101000001_add_y/migration.sql'
  const FILES: Record<string, string> = {
    [DROP]: 'ALTER TABLE "x" DROP COLUMN "y";',
    [ADD]: 'ALTER TABLE "x" ADD COLUMN "z" TEXT;',
  }

  const deployments = (nodes: { state: string; oid: string }[]) =>
    JSON.stringify({
      data: {
        repository: {
          deployments: { nodes: nodes.map(({ state, oid }) => ({ state, commit: { oid } })) },
        },
      },
    })

  /** A `gh` stub that answers the deployments query. */
  const ghWith =
    (body: string): Run =>
    (args) => {
      expect(args.slice(0, 2)).toEqual(['api', 'graphql'])
      expect(args).toContain('owner=kaupok')
      expect(args).toContain('name=wobblepot')
      return body
    }

  /** A `git` stub: `known` commits exist, `diff` lists `added`, `ls-tree` lists `all`. */
  const gitWith = (options: { known: string[]; added: string[]; all?: string[] }) => {
    const calls: string[][] = []
    const git: Run = (args) => {
      calls.push(args)
      if (args[0] === 'cat-file') {
        if (options.known.some((sha) => args[2] === `${sha}^{commit}`)) return ''
        throw new Error('missing')
      }
      if (args[0] === 'diff') return `${options.added.join('\n')}\n`
      if (args[0] === 'ls-tree') return `${(options.all ?? []).join('\n')}\n`
      if (args[0] === 'show') {
        const sql = FILES[(args[1] ?? '').slice(TARGET.length + 1)]
        if (sql === undefined) throw new Error(`no fixture for ${args[1]}`)
        return sql
      }
      throw new Error(`unexpected git ${args.join(' ')}`)
    }
    return { git, calls }
  }

  it('holds a run whose pending migrations drop data', () => {
    const { git, calls } = gitWith({ known: [LIVE], added: [DROP, ADD] })
    const gate = deployGate({
      repo: REPO,
      target: TARGET,
      confirmed: false,
      inputSha: '',
      gh: ghWith(
        deployments([
          { state: 'INACTIVE', oid: 'c'.repeat(40) },
          { state: 'ACTIVE', oid: LIVE },
        ]),
      ),
      git,
    })
    expect(gate.baseline).toBe(LIVE)
    expect(gate.pending).toEqual([DROP, ADD])
    expect(gate.findings).toEqual([
      {
        migration: '20261101000000_drop_x',
        statement: 'ALTER TABLE "x" DROP COLUMN "y"',
        patterns: ['DROP COLUMN'],
      },
    ])
    expect(gate.held).toBe(true)
    expect(calls).toContainEqual([
      'diff',
      '--diff-filter=A',
      '--name-only',
      LIVE,
      TARGET,
      '--',
      'prisma/migrations',
    ])
    expect(calls).toContainEqual(['show', `${TARGET}:${DROP}`])
  })

  it('lets the same run through when confirm_destructive is true', () => {
    const { git } = gitWith({ known: [LIVE], added: [DROP] })
    const gate = deployGate({
      repo: REPO,
      target: TARGET,
      confirmed: true,
      inputSha: TARGET,
      gh: ghWith(deployments([{ state: 'ACTIVE', oid: LIVE }])),
      git,
    })
    expect(gate.findings).toHaveLength(1)
    expect(gate.held).toBe(false)
  })

  it('refuses a confirmation without a pinned sha', () => {
    const { git } = gitWith({ known: [LIVE], added: [DROP] })
    expect(() =>
      deployGate({
        repo: REPO,
        target: TARGET,
        confirmed: true,
        inputSha: '',
        gh: ghWith(deployments([{ state: 'ACTIVE', oid: LIVE }])),
        git,
      }),
    ).toThrow('confirm_destructive needs the sha of the held run')
  })

  it('passes a run whose pending migrations are additive', () => {
    const { git } = gitWith({
      known: [LIVE],
      added: [ADD, 'prisma/migrations/migration_lock.toml'],
    })
    const gate = deployGate({
      repo: REPO,
      target: TARGET,
      confirmed: false,
      inputSha: '',
      gh: ghWith(deployments([{ state: 'ACTIVE', oid: LIVE }])),
      git,
    })
    expect(gate.pending).toEqual([ADD])
    expect(gate.findings).toEqual([])
    expect(gate.held).toBe(false)
  })

  it('checks every migration when no record is ACTIVE', () => {
    const { git, calls } = gitWith({ known: [LIVE], added: [], all: [ADD, DROP] })
    const gate = deployGate({
      repo: REPO,
      target: TARGET,
      confirmed: false,
      inputSha: '',
      gh: ghWith(deployments([{ state: 'INACTIVE', oid: LIVE }])),
      git,
    })
    expect(gate.baseline).toBeNull()
    expect(gate.pending).toEqual([DROP, ADD])
    expect(gate.held).toBe(true)
    expect(calls.some((args) => args[0] === 'diff')).toBe(false)
  })

  it('checks every migration when the live commit is not in the clone', () => {
    const { git } = gitWith({ known: [], added: [], all: [DROP] })
    const gate = deployGate({
      repo: REPO,
      target: TARGET,
      confirmed: false,
      inputSha: '',
      gh: ghWith(deployments([{ state: 'ACTIVE', oid: LIVE }])),
      git,
    })
    expect(gate.baseline).toBe(LIVE)
    expect(gate.pending).toEqual([DROP])
    expect(gate.held).toBe(true)
  })
})

describe('the PR-time CLI', () => {
  /** Runs the script as `ci.yml` does and returns its GITHUB_OUTPUT and GITHUB_STEP_SUMMARY. */
  function runCli(dirs: string[]) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'destructive-'))
    const output = path.join(tmp, 'output')
    const summary = path.join(tmp, 'summary')
    try {
      execFileSync(
        process.execPath,
        [path.join(root, 'scripts/check-destructive-migrations.ts'), ...dirs],
        {
          env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary },
          stdio: 'pipe',
        },
      )
      const read = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')
      return { output: read(output), summary: read(summary) }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }

  it('writes found=true and the list to the summary for a destructive migration', () => {
    const { output, summary } = runCli([DROP_FOOD_COLUMNS, ADD_NOTE])
    expect(output).toBe('found=true\n')
    expect(summary).toContain('### Destructive migration statements')
    expect(summary).toContain(
      '- `20261026150000_drop_member_preferences_food_columns`: DROP COLUMN — ',
    )
    expect(summary).not.toContain('add_note_to_meal_plan_entry')
  })

  it('writes found=false and no summary for an additive migration, or none', () => {
    expect(runCli([ADD_NOTE])).toEqual({ output: 'found=false\n', summary: '' })
    expect(runCli([])).toEqual({ output: 'found=false\n', summary: '' })
  })
})

describe('ci.yml destructive-migrations job', () => {
  const source = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')
  const lines = source.split('\n')
  const start = lines.indexOf('  destructive-migrations:')
  const end = lines.findIndex((line, i) => i > start && /^ {2}\S/.test(line))
  const job = lines.slice(start, end).join('\n')

  it('runs on PRs with a token that can label', () => {
    expect(start).toBeGreaterThan(-1)
    expect(job).toContain("    if: github.event_name == 'pull_request'\n")
    expect(job).toContain('      pull-requests: write\n')
    expect(job).toContain('          fetch-depth: 0\n')
  })

  it('checks only the migrations the PR adds, and fails the step when the diff fails', () => {
    expect(job).toContain('        id: check\n')
    expect(job).toContain(
      `          added=$(git diff --diff-filter=A --name-only "$BASE_SHA"...HEAD -- 'prisma/migrations/*/migration.sql')\n`,
    )
    expect(job).toContain('          node scripts/check-destructive-migrations.ts "${dirs[@]}"\n')
  })

  it('labels the PR when the check found a match, and never fails on the label', () => {
    expect(job).toContain(
      "        if: steps.check.outputs.found == 'true'\n        continue-on-error: true\n",
    )
    expect(job).toContain(`issues/$PR_NUMBER/labels" -f 'labels[]=${LABEL}'`)
  })

  it('stays out of the required aggregate, so a finding never fails the PR', () => {
    const ci = lines.slice(lines.indexOf('  ci:')).join('\n')
    expect(ci).toMatch(/^ {4}needs: \[static, unit, unit-report, storybook, e2e\]$/m)
  })
})
