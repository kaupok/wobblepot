/**
 * `scripts/e2e-local.sh serve` — the local review server (HON-851).
 *
 * Runs the real script from a scratch repo root with `pnpm` and `curl` stubbed
 * on PATH, so nothing here touches Neon, Prisma or a port. The stub `pnpm`
 * logs every call; `neonctl` is reached through `pnpm dlx`, so "never calls
 * neonctl" and "never runs migrate deploy" are assertions on that log. The stub
 * dev server records the environment it was started with and marks the port as
 * answering, which is what the stub `curl` reports back.
 *
 * Toolchain preparation (HON-1315) runs on file mtimes: each test starts with an
 * up-to-date lockfile, Prisma client and Chromium build, so only the
 * `toolchain preparation` tests see an install step.
 */
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  calls,
  root,
  run,
  script,
  serverEnv,
  setupScratchRepo,
  stubDir,
  stubEnv,
} from './e2e-local.fixtures'

setupScratchRepo()

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

    // A bare `pnpm db:seed` keeps a shell-exported DATABASE_URL (dotenv does
    // not override), so it seeded another database than this server reads
    // (HON-1272). --seed runs it with .env's value instead.
    it('seeds the .env database with --seed, even when the shell exports another', () => {
      const { status, stderr } = run(['serve', '--db', 'env', '--seed'], {
        DATABASE_URL: 'postgres://shell-db',
      })
      const log = calls()

      expect(status).toBe(0)
      expect(stderr).toContain('Seeding the .env database')
      expect(fs.readFileSync(path.join(stubDir, 'seed.db'), 'utf8').trim()).toBe(
        'postgres://env-db',
      )
      // Seeded only after the schema check passed, and before the server starts.
      expect(log.indexOf('pnpm prisma migrate status')).toBeGreaterThanOrEqual(0)
      expect(log.indexOf('pnpm db:seed')).toBeGreaterThan(log.indexOf('pnpm prisma migrate status'))
      expect(log.indexOf('pnpm exec next dev')).toBeGreaterThan(log.indexOf('pnpm db:seed'))
    })

    it('plants no fixture users in the .env database without their credentials', () => {
      const { status } = run(['serve', '--db', 'env', '--seed'])

      expect(status).toBe(0)
      expect(calls()).not.toContain('print-seed-test-user-defaults')
      for (const env of [serverEnv('seed'), serverEnv()]) {
        expect(env.has('SEED_TEST_USERS')).toBe(false)
        expect(env.has('SMOKE_TEST_EMAIL')).toBe(false)
      }
    })

    it('does not seed with --seed when the .env database is behind', () => {
      const { status } = run(['serve', '--db', 'env', '--seed'], {
        STUB_MIGRATE_STATUS: 'Following migration have not yet been applied: 20260929_x',
        STUB_MIGRATE_RC: '1',
      })

      expect(status).not.toBe(0)
      expect(calls()).not.toContain('db:seed')
    })

    it('warns that accounts persist and points at the cleanup docs', () => {
      const { stderr } = run(['serve', '--db', 'env'])

      expect(stderr).toContain('persist after this server stops')
      expect(stderr).toContain('docs/BROWSER_TESTING.md')
    })
  })

  describe('serve (branch mode)', () => {
    it('migrates but does not seed, and deletes its branch on exit', () => {
      const { status, stdout } = run(['serve'])
      const log = calls()

      expect(status).toBe(0)
      expect(stdout).toMatch(
        /REVIEW-READY http:\/\/localhost:3200 db=e2e-local-[a-z0-9]+-\d{8}-\d{6}-\d+\s/,
      )
      expect(log).toContain('pnpm prisma migrate deploy')
      expect(log).not.toContain('db:seed')
      expect(log).toMatch(/branches delete e2e-local-/)

      const env = serverEnv()
      expect(env.get('DATABASE_URL')).toBe('postgres://branch-pooled')
      expect(env.get('NEXT_PUBLIC_APP_ENV')).toBe('test')
      expect(env.has('SIGNUP_TIMING_LOG')).toBe(false)
      expect(env.has('E2E_LOCAL_PORT')).toBe(false)
    })

    it('seeds the branch with --seed', () => {
      const { stderr } = run(['serve', '--seed'])

      expect(calls()).toContain('pnpm db:seed')
      expect(stderr).toContain('Seeding the ephemeral branch')
      expect(fs.readFileSync(path.join(stubDir, 'seed.db'), 'utf8').trim()).toBe(
        'postgres://branch-pooled',
      )
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

  describe('run (test:e2e:local)', () => {
    // HON-1415: the run's pid is gone once it exits, so the old name would
    // read as dead to the next GC on this host.
    it('renames a --keep branch out of the pid rule instead of deleting it', () => {
      const { status } = run(['--keep'])

      expect(status).toBe(0)
      expect(calls()).toMatch(/branches rename e2e-local-(\S+) e2e-local-kept-\1 /)
      expect(calls()).not.toContain('branches delete')
    })

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

    // HON-1594: smoke-fixture specs skipped locally, and a skip exits 0.
    it('gives the seed and Playwright the default fixture users on its branch', () => {
      const { status } = run([])

      expect(status).toBe(0)
      for (const env of [serverEnv('seed'), serverEnv()]) {
        expect(env.get('SEED_TEST_USERS')).toBe('1')
        expect(env.get('SMOKE_TEST_EMAIL')).toBe('default-smoke@test')
        expect(env.get('SMOKE_TEST_PASSWORD')).toBe('default-smoke-pass')
        expect(env.get('FORGOT_PASSWORD_TEST_EMAIL')).toBe('default-forgot@test')
        expect(env.get('FORGOT_PASSWORD_TEST_PASSWORD')).toBe('default-forgot-pass')
      }
    })

    it('keeps fixture credentials the shell sets and fills the rest', () => {
      const { status } = run([], {
        SMOKE_TEST_EMAIL: 'ci-smoke@test',
        SMOKE_TEST_PASSWORD: 'ci-smoke-pass',
      })

      expect(status).toBe(0)
      const env = serverEnv()
      expect(env.get('SEED_TEST_USERS')).toBe('1')
      expect(env.get('SMOKE_TEST_EMAIL')).toBe('ci-smoke@test')
      expect(env.get('SMOKE_TEST_PASSWORD')).toBe('ci-smoke-pass')
      expect(env.get('FORGOT_PASSWORD_TEST_EMAIL')).toBe('default-forgot@test')
      expect(env.get('FORGOT_PASSWORD_TEST_PASSWORD')).toBe('default-forgot-pass')
    })

    it('stops before the seed when it cannot read the default credentials', () => {
      const { status, stderr } = run([], { STUB_FAIL_STEP: 'defaults' })

      expect(status).not.toBe(0)
      expect(stderr).toContain("Could not read the seed's default fixture credentials")
      expect(calls()).not.toContain('pnpm db:seed')
    })

    it('exports the shared environment from one place', () => {
      const source = fs.readFileSync(script, 'utf8')

      expect(source.split('export E2E_DISABLE_RATE_LIMIT=').length - 1).toBe(1)
      expect(source.split('export CRON_SECRET=').length - 1).toBe(1)
    })
  })
})
