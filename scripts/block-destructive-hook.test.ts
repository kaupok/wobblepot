/**
 * The destructive-command PreToolUse hook (HON-727).
 *
 * `.claude/hooks/block-destructive.mts` is the only mechanical guard between a
 * headless `--dangerously-skip-permissions` worker and a reset staging
 * database, a push to `main`, or an unrequested merge — so every blocked
 * pattern, and the read-only commands that merely *mention* one, is pinned
 * here. The last block spawns the real `.sh` entrypoint with hook-shaped JSON,
 * which is what Claude Code runs.
 *
 * Lives in scripts/ next to the other Vitest files that drive shell.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  checkCommand,
  splitSegments,
  type CheckContext,
} from '../.claude/hooks/block-destructive.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const hook = path.join(repoRoot, '.claude/hooks/block-destructive.sh')

const ctx = (overrides: Partial<CheckContext> = {}): CheckContext => ({
  cwd: repoRoot,
  env: {},
  currentBranch: () => 'kaupo/hon-1-feature',
  scripts: {
    'db:push': 'prisma db push',
    'db:migrate': 'prisma migrate dev',
    'db:studio': 'prisma studio',
    test: 'vitest run --project=unit',
  },
  readFile: () => null,
  ...overrides,
})

const blocked = (command: string, overrides?: Partial<CheckContext>) =>
  checkCommand(command, ctx(overrides)).blocked

describe('database commands', () => {
  it.each([
    'prisma migrate reset',
    'pnpm prisma migrate reset',
    'npx prisma migrate reset --force',
    'pnpm exec prisma migrate reset --skip-seed',
    './node_modules/.bin/prisma migrate reset',
    'DATABASE_URL=postgres://x pnpm prisma migrate reset',
    'cd /tmp && prisma migrate reset',
    'pnpm prisma migrate \\\n  reset --force',
  ])('blocks migrate reset: %s', (command) => {
    expect(blocked(command)).toBe(true)
  })

  it.each(['pnpm db:reset', 'npm run db:reset', 'pnpm run migrate:reset', 'yarn reset-db'])(
    'blocks reset-style script wrappers: %s',
    (command) => {
      expect(blocked(command)).toBe(true)
    },
  )

  it.each([
    'prisma db push --force-reset',
    'prisma db push --accept-data-loss',
    'pnpm db:push --force-reset',
    'pnpm run db:push -- --accept-data-loss',
    'pnpm --filter web db:push --force-reset',
    'npx prisma db push --schema prisma/schema.prisma --accept-data-loss',
  ])('blocks data-losing db push: %s', (command) => {
    expect(blocked(command)).toBe(true)
  })

  it.each([
    'psql "$DATABASE_URL" -c "DROP TABLE users"',
    'psql -c "drop database wobblepot"',
    'psql -c "DROP SCHEMA public CASCADE"',
    'psql -c "TRUNCATE meals"',
    'echo "DROP TABLE users;" | psql "$DATABASE_URL"',
    'echo "TRUNCATE sessions" | pnpm prisma db execute --stdin',
    'psql "$DATABASE_URL" <<\'SQL\'\nDROP TABLE users;\nSQL',
  ])('blocks destructive SQL sent to a database: %s', (command) => {
    expect(blocked(command)).toBe(true)
  })

  it('blocks destructive SQL in a file passed to psql -f or db execute --file', () => {
    const readFile = () => 'BEGIN; DROP TABLE users; COMMIT;'
    expect(blocked('psql -f cleanup.sql', { readFile })).toBe(true)
    expect(blocked('prisma db execute --file cleanup.sql', { readFile })).toBe(true)
  })

  it.each([
    'pnpm db:migrate',
    'pnpm db:push',
    'pnpm prisma migrate deploy',
    'prisma migrate resolve --applied 20260101_init',
    'psql -c "SELECT count(*) FROM users"',
    'psql -f read-only.sql',
  ])('allows non-destructive database commands: %s', (command) => {
    expect(blocked(command)).toBe(false)
  })
})

describe('git push', () => {
  it.each([
    'git push origin main',
    'git push origin HEAD:main',
    'git push origin feature:refs/heads/main',
    'git push origin :main',
    'git push --delete origin main',
    'git -C ../other push origin main',
    'git push --all',
    'git push --mirror origin',
    'git push --repo origin main',
    'git push --repo=origin HEAD:main',
    'git \\\n  push origin main',
  ])('blocks pushes to main: %s', (command) => {
    expect(blocked(command)).toBe(true)
  })

  it('blocks a bare push, or a HEAD push, while on main', () => {
    const onMain = { currentBranch: () => 'main' }
    expect(blocked('git push', onMain)).toBe(true)
    expect(blocked('git push origin', onMain)).toBe(true)
    expect(blocked('git push origin HEAD', onMain)).toBe(true)
  })

  it.each([
    'git push --force',
    'git push -f origin feature',
    'git push -uf origin feature',
    'git push --force-with-lease origin feature',
    'git push --force-with-lease=feature:abc123 origin feature',
    'git push origin +feature',
  ])('blocks force pushes to any branch: %s', (command) => {
    expect(blocked(command)).toBe(true)
  })

  it.each([
    'git push',
    'git push -u origin kaupo/hon-1-feature',
    'git push -u origin $(git branch --show-current)',
    'git push origin posthog/hon-1-x',
    'git push origin HEAD',
    'git push origin maintenance',
    'git push --follow-tags origin feature 2>&1',
  ])('allows pushes to a feature branch: %s', (command) => {
    expect(blocked(command)).toBe(false)
  })
})

describe('gh pr merge', () => {
  it.each([
    'gh pr merge',
    'gh pr merge --squash --delete-branch',
    'gh pr merge 123 --squash',
    'gh -R kaupok/wobblepot pr merge 1',
    'gh api -X PUT repos/kaupok/wobblepot/pulls/1/merge',
    'WOBBLEPOT_ALLOW_MERGE=0 gh pr merge --squash',
  ])('blocks a merge without the opt-in: %s', (command) => {
    expect(blocked(command)).toBe(true)
  })

  it('allows a merge opted in inline or through the environment', () => {
    expect(blocked('WOBBLEPOT_ALLOW_MERGE=1 gh pr merge --squash')).toBe(false)
    expect(blocked('gh pr merge --squash', { env: { WOBBLEPOT_ALLOW_MERGE: '1' } })).toBe(false)
  })

  it('does not carry an inline opt-in over to the next command', () => {
    expect(blocked('WOBBLEPOT_ALLOW_MERGE=1 true && gh pr merge --squash')).toBe(true)
  })

  it.each([
    'gh pr view --json number,state,mergeable,mergeStateStatus',
    'gh pr list --search "merge"',
    'gh api repos/kaupok/wobblepot/pulls/1/merge',
  ])('allows read-only gh calls: %s', (command) => {
    expect(blocked(command)).toBe(false)
  })
})

describe('commands that only mention a blocked phrase', () => {
  it.each([
    'grep "migrate reset" docs/',
    'grep -rn "git push origin main" .claude/skills',
    "grep -E 'db push --force-reset|DROP TABLE' CLAUDE.md",
    'cat docs/GIT_WORKFLOW.md | grep "gh pr merge"',
    'echo "never run prisma migrate reset"',
    '# prisma migrate reset\nls',
    'git commit -m "$(cat <<\'EOF\'\nfix: Guard merges\n\ngh pr merge now needs an opt-in\nEOF\n)"',
    "cat > notes.md <<'EOF'\ngit push origin main\nprisma migrate reset\nEOF\nwc -l notes.md",
    'gh pr create --body "Blocks \\`git push --force\\` and \\`DROP TABLE\\`"',
    'grep -c TRUNCATE prisma/migrations/*/migration.sql',
  ])('allows: %s', (command) => {
    expect(blocked(command)).toBe(false)
  })
})

describe('wrappers', () => {
  it.each([
    "bash -c 'prisma migrate reset'",
    'sh -lc "git push origin main"',
    'eval "gh pr merge"',
    'sudo -E prisma migrate reset',
    'env FOO=1 prisma migrate reset',
    '(cd /tmp && git push origin main)',
    'true; { git push origin main; }',
    'if true; then prisma migrate reset; fi',
    'timeout 60 pnpm prisma migrate reset',
    'nice -n 10 pnpm prisma migrate reset',
    'sudo -u postgres psql -c "DROP TABLE users"',
    "bash <<'EOF'\nprisma migrate reset\nEOF",
    'sh -s <<EOF\ngit push origin main\nEOF',
  ])('sees through: %s', (command) => {
    expect(blocked(command)).toBe(true)
  })
})

describe('splitSegments', () => {
  it('splits on unquoted operators and keeps quoted text whole', () => {
    expect(splitSegments('a && b | c; d || "e && f" 2>&1 & g')).toEqual([
      'a',
      'b',
      'c',
      'd',
      '"e && f" 2>&1',
      'g',
    ])
  })
})

describe('hook entrypoint', () => {
  const run = (command: string, toolName = 'Bash') =>
    spawnSync(hook, {
      input: JSON.stringify({ tool_name: toolName, cwd: repoRoot, tool_input: { command } }),
      encoding: 'utf8',
    })

  it('exits 2 with the reason on stderr when blocked', () => {
    const result = run('pnpm prisma migrate reset')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('prisma migrate reset')
  })

  it('exits 0 silently when allowed', () => {
    const result = run('git push -u origin kaupo/hon-1-feature')
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
  })

  it('ignores tools other than Bash', () => {
    expect(run('prisma migrate reset', 'Read').status).toBe(0)
  })

  it('fails open on malformed input', () => {
    const result = spawnSync(hook, { input: 'not json', encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('failed open')
  })
})
