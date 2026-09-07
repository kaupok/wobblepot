/**
 * The migration-immutability guard (HON-641).
 *
 * `scripts/check-migrations-immutable.sh` is the only thing standing between a
 * PR that edits an already-applied `migration.sql` and the checksum drift that
 * bricked the dev database in HON-558 — so its pass/fail decision needs to be
 * exercised, not eyeballed. Each case below builds a throwaway git repository
 * in a temp directory and runs the real script against it, which is also how
 * the issue's two manual acceptance criteria ("fails on an edit", "passes on a
 * branch that only adds a migration") stay verified after this PR merges.
 *
 * Lives in scripts/ next to ci-settle-gate.test.ts, the other Vitest file that
 * drives shell rather than app code.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const script = path.join(repoRoot, 'scripts/check-migrations-immutable.sh')

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * `core.hooksPath` and `commit.gpgsign` are pinned so a developer's global git
 * config can't make these fixtures fail — Husky is installed in this repo.
 */
function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim()
}

function write(dir: string, relativePath: string, content: string): void {
  const absolute = path.join(dir, relativePath)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, content)
}

const INIT_SQL = 'CREATE TABLE "ingredient" ("id" TEXT NOT NULL);\n'
const INIT_MIGRATION = 'prisma/migrations/20260101000000_init/migration.sql'

/** A repo whose `main` already carries one migration, as the real repo does. */
function repoWithAppliedMigration(): { dir: string; base: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hon641-'))
  tempDirs.push(dir)

  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'Migration Guard Test')

  write(dir, 'prisma/migrations/migration_lock.toml', 'provider = "postgresql"\n')
  write(dir, INIT_MIGRATION, INIT_SQL)
  write(dir, 'src/app/page.tsx', 'export default function Page() {\n  return null\n}\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'base: one applied migration')

  return { dir, base: git(dir, 'rev-parse', 'HEAD') }
}

function commitAll(dir: string, message: string): void {
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', message)
}

type Result = { status: number; stdout: string; stderr: string }

function runCheck(cwd: string, ...args: string[]): Result {
  try {
    const stdout = execFileSync('bash', [script, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, stdout, stderr: '' }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return {
      status: failure.status ?? -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    }
  }
}

describe('check-migrations-immutable.sh', () => {
  describe('allows what a normal migration PR does', () => {
    it('passes when the branch only adds a new migration directory', () => {
      const { dir, base } = repoWithAppliedMigration()
      write(
        dir,
        'prisma/migrations/20260202000000_add_pantry/migration.sql',
        'CREATE TABLE "pantry_item" ("id" TEXT NOT NULL);\n',
      )
      commitAll(dir, 'feat(db): Add pantry')

      const result = runCheck(dir, base)

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    })

    it('passes when the branch changes nothing under prisma/migrations', () => {
      const { dir, base } = repoWithAppliedMigration()
      write(dir, 'src/app/page.tsx', 'export default function Page() {\n  return <div />\n}\n')
      commitAll(dir, 'feat: Unrelated change')

      expect(runCheck(dir, base).status).toBe(0)
    })

    // migration_lock.toml records the datasource provider, not applied SQL, so
    // Prisma never checksums it and rewriting it drifts nothing.
    it('ignores migration_lock.toml', () => {
      const { dir, base } = repoWithAppliedMigration()
      write(dir, 'prisma/migrations/migration_lock.toml', 'provider = "postgres"\n')
      commitAll(dir, 'chore(db): Rewrite the lock file')

      expect(runCheck(dir, base).status).toBe(0)
    })
  })

  describe('rejects changes to a migration already on the base', () => {
    it('fails on an edited migration.sql, printing the path', () => {
      const { dir, base } = repoWithAppliedMigration()
      write(dir, INIT_MIGRATION, `${INIT_SQL}ALTER TABLE "ingredient" ADD COLUMN "note" TEXT;\n`)
      commitAll(dir, 'fix(db): Sneak a column into an applied migration')

      const result = runCheck(dir, base)

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(INIT_MIGRATION)
      expect(result.stderr).toContain('immutable')
    })

    it('fails on a deleted migration.sql', () => {
      const { dir, base } = repoWithAppliedMigration()
      fs.rmSync(path.join(dir, 'prisma/migrations/20260101000000_init'), { recursive: true })
      commitAll(dir, 'chore(db): Drop an applied migration')

      const result = runCheck(dir, base)

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(INIT_MIGRATION)
    })

    // Renaming the directory is how a migration gets "reordered" by hand. Git
    // may report it as R100 or as a D/A pair depending on rename detection;
    // either way the old path is gone from where the database recorded it.
    it('fails when an applied migration directory is renamed', () => {
      const { dir, base } = repoWithAppliedMigration()
      git(
        dir,
        'mv',
        'prisma/migrations/20260101000000_init',
        'prisma/migrations/20260301000000_init',
      )
      commitAll(dir, 'chore(db): Renumber an applied migration')

      const result = runCheck(dir, base)

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('20260101000000_init/migration.sql')
    })

    it('fails when several migrations are touched, listing each', () => {
      const { dir } = repoWithAppliedMigration()
      write(
        dir,
        'prisma/migrations/20251201000000_earlier/migration.sql',
        'CREATE TABLE "earlier" ("id" TEXT NOT NULL);\n',
      )
      commitAll(dir, 'base: a second applied migration')
      const twoMigrationBase = git(dir, 'rev-parse', 'HEAD')

      write(dir, INIT_MIGRATION, 'CREATE TABLE "ingredient" ();\n')
      write(dir, 'prisma/migrations/20251201000000_earlier/migration.sql', 'SELECT 1;\n')
      commitAll(dir, 'fix(db): Edit both')

      const result = runCheck(dir, twoMigrationBase)

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(INIT_MIGRATION)
      expect(result.stderr).toContain('20251201000000_earlier/migration.sql')
    })

    // The base is only ever `main` in CI, but the branch must be diffed against
    // the fork point rather than the base tip — otherwise a migration that
    // landed on main after the branch started reads as a spurious deletion.
    it('ignores migrations added to the base after the branch forked', () => {
      const { dir, base } = repoWithAppliedMigration()
      git(dir, 'checkout', '-q', '-b', 'feature')
      write(dir, 'src/app/page.tsx', 'export default function Page() {\n  return <span />\n}\n')
      commitAll(dir, 'feat: Branch work')
      const branchHead = git(dir, 'rev-parse', 'HEAD')

      git(dir, 'checkout', '-q', 'main')
      write(
        dir,
        'prisma/migrations/20260401000000_added_on_main/migration.sql',
        'CREATE TABLE "later" ("id" TEXT NOT NULL);\n',
      )
      commitAll(dir, 'feat(db): Land a migration on main')
      const mainTip = git(dir, 'rev-parse', 'HEAD')

      git(dir, 'checkout', '-q', branchHead)

      expect(mainTip).not.toBe(base)
      expect(runCheck(dir, 'main').status).toBe(0)
    })

    // The `prisma/migrations/` pathspec would otherwise resolve relative to the
    // caller's directory, matching nothing and reporting a confident pass.
    it('detects the edit when run from a subdirectory', () => {
      const { dir, base } = repoWithAppliedMigration()
      write(dir, INIT_MIGRATION, `${INIT_SQL}ALTER TABLE "ingredient" ADD COLUMN "note" TEXT;\n`)
      commitAll(dir, 'fix(db): Edit an applied migration')

      const result = runCheck(path.join(dir, 'prisma'), base)

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(INIT_MIGRATION)
    })

    // docs/GIT_WORKFLOW.md puts the local run at step 5 — after `git add -A`
    // and before `git commit` — so a guard that compares two commits is blind
    // at exactly the moment a developer is told to run it.
    it('fails on a staged but uncommitted edit', () => {
      const { dir, base } = repoWithAppliedMigration()
      write(dir, INIT_MIGRATION, `${INIT_SQL}ALTER TABLE "ingredient" ADD COLUMN "note" TEXT;\n`)
      git(dir, 'add', '-A')

      const result = runCheck(dir, base)

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(INIT_MIGRATION)
    })

    it('fails on an unstaged edit', () => {
      const { dir, base } = repoWithAppliedMigration()
      write(dir, INIT_MIGRATION, 'DROP TABLE "ingredient";\n')

      const result = runCheck(dir, base)

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(INIT_MIGRATION)
    })

    // The flip side of reading the working tree: a clean checkout must still
    // pass, or every CI run on a legitimate branch goes red.
    it('passes on a clean tree that only added a migration', () => {
      const { dir, base } = repoWithAppliedMigration()
      write(
        dir,
        'prisma/migrations/20260505000000_add_notes/migration.sql',
        'CREATE TABLE "note" ("id" TEXT NOT NULL);\n',
      )
      commitAll(dir, 'feat(db): Add notes')

      expect(git(dir, 'status', '--porcelain')).toBe('')
      expect(runCheck(dir, base).status).toBe(0)
    })
  })

  describe('fails loudly rather than passing when it cannot compute', () => {
    it('exits 2 with usage when BASE_REF is missing', () => {
      const { dir } = repoWithAppliedMigration()

      const result = runCheck(dir)

      expect(result.status).toBe(2)
      expect(result.stderr).toContain('Usage:')
    })

    it('exits 2 when BASE_REF does not resolve to a commit', () => {
      const { dir } = repoWithAppliedMigration()

      const result = runCheck(dir, 'origin/does-not-exist')

      expect(result.status).toBe(2)
      expect(result.stderr).toContain('does not resolve')
    })

    // CI checks out shallow, where `git diff BASE...HEAD` can die with "no
    // merge base". The script falls back to diffing the two trees; unrelated
    // histories are the local stand-in for that grafted state.
    it('still detects an edit when the histories share no merge base', () => {
      const { dir } = repoWithAppliedMigration()
      const orphanBase = git(dir, 'rev-parse', 'HEAD')

      git(dir, 'checkout', '-q', '--orphan', 'grafted')
      write(dir, INIT_MIGRATION, 'DROP TABLE "ingredient";\n')
      commitAll(dir, 'grafted: a different version of the same migration')

      expect(() => git(dir, 'merge-base', orphanBase, 'HEAD')).toThrow()

      const result = runCheck(dir, orphanBase)

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(INIT_MIGRATION)
      expect(result.stderr).toContain('no merge base')
      // Without a merge base the script cannot tell "this branch changed it"
      // from "the base has it and this tree does not", so it must not claim
      // authorship in the header.
      expect(result.stderr).toContain('this tree differs from')
      expect(result.stderr).not.toContain('this branch changes')
    })

    // The fallback is the weaker comparison — a branch merely behind the base
    // can be blamed for a migration it never touched — so which branch ran has
    // to be visible in the CI log rather than inferred. ci.yml checks out with
    // `fetch-depth: 0` so that CI never takes it.
    it('says nothing about a fallback when a merge base exists', () => {
      const { dir, base } = repoWithAppliedMigration()
      write(dir, INIT_MIGRATION, 'DROP TABLE "ingredient";\n')
      commitAll(dir, 'fix(db): Edit an applied migration')

      const result = runCheck(dir, base)

      expect(result.status).toBe(1)
      expect(result.stderr).not.toContain('no merge base')
      // With a merge base, authorship *is* established — say so.
      expect(result.stderr).toContain('this branch changes')
    })
  })
})
