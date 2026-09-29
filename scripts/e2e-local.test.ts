/**
 * `scripts/e2e-local.sh serve` — the local review server (HON-851).
 *
 * Runs the real script from a scratch repo root with `pnpm` and `curl` stubbed
 * on PATH, so nothing here touches Neon, Prisma or a port. The stub `pnpm`
 * logs every call; `neonctl` is reached through `pnpm dlx`, so "never calls
 * neonctl" and "never runs migrate deploy" are assertions on that log. The stub
 * dev server records the environment it was started with and marks the port as
 * answering, which is what the stub `curl` reports back.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'e2e-local.sh')

const PNPM_STUB = `#!/usr/bin/env bash
echo "pnpm $*" >> "$STUB_DIR/calls.log"
record_env() {
  env | grep -E '^(DATABASE_URL|DATABASE_URL_UNPOOLED|NEXT_PUBLIC_APP_ENV|NEXT_PUBLIC_APP_URL|E2E_DISABLE_RATE_LIMIT|SIGNUP_TIMING_LOG|E2E_LOCAL_PORT|CRON_SECRET)=' | sort > "$STUB_DIR/server.env"
}
case "$*" in
  "dlx neonctl@"*" branches create "*)
    if [ -n "\${STUB_CAP:-}" ]; then echo "ERROR: branches limit exceeded" >&2; exit 1; fi
    echo '{}' ;;
  "dlx neonctl@"*" connection-string "*"--pooled"*) echo "postgres://branch-pooled" ;;
  "dlx neonctl@"*" connection-string "*) echo "postgres://branch-unpooled" ;;
  "dlx neonctl@"*" branches list "*) echo '[]' ;;
  "dlx neonctl@"*) ;;
  "prisma migrate status")
    echo "\${STUB_MIGRATE_STATUS:-Database schema is up to date!}"
    exit "\${STUB_MIGRATE_RC:-0}" ;;
  "exec next dev "*)
    record_env
    echo "$$" > "$STUB_DIR/server.pid"
    touch "$STUB_DIR/server-up"
    exec sleep "\${STUB_SERVER_SECS:-1}" ;;
  "exec playwright "*) record_env ;;
esac
`

const CURL_STUB = `#!/usr/bin/env bash
for arg; do url="$arg"; done
echo "curl $url" >> "$STUB_DIR/calls.log"
if [ -e "$STUB_DIR/server-up" ]; then printf 200; else printf 000; exit 7; fi
`

let root: string
let stubDir: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-local-'))
  stubDir = path.join(root, 'stub')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(path.join(root, 'scripts'))
  fs.mkdirSync(stubDir)
  fs.mkdirSync(bin)
  fs.copyFileSync(script, path.join(root, 'scripts', 'e2e-local.sh'))
  fs.writeFileSync(
    path.join(root, '.env'),
    [
      'DATABASE_URL=postgres://env-db',
      'DATABASE_URL_UNPOOLED=postgres://env-db-unpooled',
      'NEON_API_KEY=neon-key',
      'NEON_PROJECT_ID=neon-project',
      '',
    ].join('\n'),
  )
  fs.writeFileSync(path.join(bin, 'pnpm'), PNPM_STUB, { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'curl'), CURL_STUB, { mode: 0o755 })
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

/**
 * A clean environment: nothing inherited from vitest's own env block, which sets
 * NEXT_PUBLIC_APP_ENV and would mask what the script exports.
 */
function stubEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    PATH: `${path.join(root, 'bin')}:${process.env.PATH ?? ''}`,
    HOME: root,
    STUB_DIR: stubDir,
    ...extra,
  }
}

function run(args: string[], extra: Record<string, string> = {}) {
  const result = spawnSync('bash', [path.join(root, 'scripts', 'e2e-local.sh'), ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    env: stubEnv(extra),
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const calls = () => {
  const file = path.join(stubDir, 'calls.log')
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

/** The environment the stub dev server (or Playwright) was started with. */
function serverEnv(): Map<string, string> {
  const lines = fs.readFileSync(path.join(stubDir, 'server.env'), 'utf8').trim().split('\n')
  return new Map(
    lines.map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  )
}

describe('e2e-local.sh', () => {
  it('lists serve, --db env and --seed in --help', () => {
    const out = execFileSync('bash', [script, '--help'], { encoding: 'utf8', timeout: 30_000 })

    expect(out).toContain('pnpm review:local')
    expect(out).toContain('--db env')
    expect(out).toContain('--seed')
  })

  describe('serve --db env', () => {
    it('prints the ready marker on port 3200 by default', () => {
      const { status, stdout } = run(['serve', '--db', 'env'])

      expect(status).toBe(0)
      expect(stdout).toMatch(/^REVIEW-READY http:\/\/localhost:3200 db=env$/m)
      expect(calls()).toContain('pnpm exec next dev --port 3200')
    })

    // The test-only routes are on and rate limiting is off, so the server must
    // not be reachable from the rest of the network.
    it('binds the dev server to loopback only', () => {
      run(['serve', '--db', 'env'])

      expect(calls()).toContain('next dev --port 3200 --hostname 127.0.0.1')
    })

    it('serves on REVIEW_LOCAL_PORT when it is set', () => {
      const { status, stdout } = run(['serve', '--db', 'env'], { REVIEW_LOCAL_PORT: '3300' })

      expect(status).toBe(0)
      expect(stdout).toContain('REVIEW-READY http://localhost:3300')
      expect(calls()).toContain('pnpm exec next dev --port 3300')
      expect(serverEnv().get('NEXT_PUBLIC_APP_URL')).toBe('http://localhost:3300')
    })

    it('never calls neonctl and never runs migrate deploy', () => {
      const { status } = run(['serve', '--db', 'env'])

      expect(status).toBe(0)
      expect(calls()).toContain('pnpm prisma migrate status')
      expect(calls()).not.toContain('neonctl')
      expect(calls()).not.toContain('migrate deploy')
      expect(calls()).not.toContain('db:seed')
    })

    it('keeps the .env database and defaults an unset app env to dev', () => {
      run(['serve', '--db=env'])
      const env = serverEnv()

      expect(env.get('DATABASE_URL')).toBe('postgres://env-db')
      // Unset would keep /api/e2e-seed at 404 and the rate limiter on.
      expect(env.get('NEXT_PUBLIC_APP_ENV')).toBe('dev')
      expect(env.get('E2E_DISABLE_RATE_LIMIT')).toBe('1')
      expect(env.has('SIGNUP_TIMING_LOG')).toBe(false)
    })

    // A deployed-environment value is the likeliest sign .env points at a
    // deployed database; overriding it to `dev` would defeat rate-limit.ts's
    // own guard and let the documented purge-cron cleanup run against it.
    it.each(['production', 'staging', 'preview'])(
      'refuses NEXT_PUBLIC_APP_ENV=%s rather than overriding it',
      (appEnv) => {
        fs.appendFileSync(path.join(root, '.env'), `NEXT_PUBLIC_APP_ENV=${appEnv}\n`)
        const { status, stderr } = run(['serve', '--db', 'env'])

        expect(status).not.toBe(0)
        expect(stderr).toContain(`NEXT_PUBLIC_APP_ENV='${appEnv}'`)
        expect(calls()).not.toContain('next dev')
      },
    )

    it('refuses to start on a database with pending migrations, naming the fix', () => {
      const { status, stderr } = run(['serve', '--db', 'env'], {
        STUB_MIGRATE_STATUS: 'Following migration have not yet been applied: 20260929_x',
        STUB_MIGRATE_RC: '1',
      })

      expect(status).not.toBe(0)
      expect(stderr).toContain('pnpm db:migrate:deploy')
      expect(calls()).not.toContain('next dev')
    })

    it('rejects --seed, which would write to the .env database', () => {
      const { status, stderr } = run(['serve', '--db', 'env', '--seed'])

      expect(status).not.toBe(0)
      expect(stderr).toContain('--seed only applies to branch mode')
      expect(calls()).not.toContain('db:seed')
    })

    it('warns that accounts persist and points at the cleanup docs', () => {
      const { stderr } = run(['serve', '--db', 'env'])

      expect(stderr).toContain('persist after this server stops')
      expect(stderr).toContain('docs/CHROME_TESTING.md')
    })
  })

  describe('serve (branch mode)', () => {
    it('migrates but does not seed, and deletes its branch on exit', () => {
      const { status, stdout } = run(['serve'])
      const log = calls()

      expect(status).toBe(0)
      expect(stdout).toMatch(/REVIEW-READY http:\/\/localhost:3200 db=e2e-local-\S+/)
      expect(log).toContain('pnpm prisma migrate deploy')
      expect(log).not.toContain('db:seed')
      expect(log).toMatch(/branches delete e2e-local-/)

      const env = serverEnv()
      expect(env.get('DATABASE_URL')).toBe('postgres://branch-pooled')
      expect(env.get('NEXT_PUBLIC_APP_ENV')).toBe('test')
      expect(env.has('SIGNUP_TIMING_LOG')).toBe(false)
      expect(env.has('E2E_LOCAL_PORT')).toBe(false)
    })

    it('seeds with --seed', () => {
      run(['serve', '--seed'])

      expect(calls()).toContain('pnpm db:seed')
    })

    it('names --db env when the branch cap is full', () => {
      const { status, stderr } = run(['serve'], { STUB_CAP: '1' })

      expect(status).not.toBe(0)
      expect(stderr).toContain('pnpm review:local --db env')
    })

    it('refuses an occupied port before creating a branch', () => {
      fs.writeFileSync(path.join(stubDir, 'server-up'), '')
      const { status, stderr } = run(['serve'])

      expect(status).not.toBe(0)
      expect(stderr).toContain('REVIEW_LOCAL_PORT')
      expect(calls()).not.toContain('neonctl')
    })

    // A plain foreground `next dev` would defer the trap until the server
    // exited on its own, leaving both the server and the branch behind.
    it('stops the server and deletes the branch when the script is killed', async () => {
      const child = spawn('bash', [path.join(root, 'scripts', 'e2e-local.sh'), 'serve'], {
        env: stubEnv({ STUB_SERVER_SECS: '60' }),
      })
      let stdout = ''
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
      const exited = new Promise<number | null>((resolve) =>
        child.on('exit', (code) => resolve(code)),
      )

      const deadline = Date.now() + 20_000
      while (!stdout.includes('REVIEW-READY') && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      expect(stdout).toContain('REVIEW-READY')

      child.kill('SIGTERM')
      expect(await exited).not.toBe(0)

      expect(calls()).toMatch(/branches delete e2e-local-/)
      const serverPid = Number(fs.readFileSync(path.join(stubDir, 'server.pid'), 'utf8'))
      expect(() => process.kill(serverPid, 0)).toThrow()
    }, 30_000)
  })

  describe('run (test:e2e:local) is unchanged', () => {
    it('uses port 3100, keeps its run-only exports and seeds', () => {
      const { status } = run([])
      const log = calls()

      expect(status).toBe(0)
      expect(log).toContain('pnpm prisma migrate deploy')
      expect(log).toContain('pnpm db:seed')
      expect(log).toContain('pnpm exec playwright test')

      const env = serverEnv()
      expect(env.get('E2E_LOCAL_PORT')).toBe('3100')
      expect(env.get('NEXT_PUBLIC_APP_URL')).toBe('http://localhost:3100')
      expect(env.get('NEXT_PUBLIC_APP_ENV')).toBe('test')
      expect(env.get('SIGNUP_TIMING_LOG')).toBe('1')
      expect(env.get('DATABASE_URL')).toBe('postgres://branch-pooled')
    })

    it('exports the shared environment from one place', () => {
      const source = fs.readFileSync(script, 'utf8')

      expect(source.split('export E2E_DISABLE_RATE_LIMIT=').length - 1).toBe(1)
      expect(source.split('export CRON_SECRET=').length - 1).toBe(1)
    })
  })
})
