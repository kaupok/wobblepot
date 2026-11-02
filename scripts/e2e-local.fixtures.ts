/**
 * Shared setup for the `scripts/e2e-local.sh` tests.
 *
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
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach } from 'vitest'

export const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
export const script = path.join(scriptsDir, 'e2e-local.sh')

export const PNPM_STUB = `#!/usr/bin/env bash
echo "pnpm $*" >> "$STUB_DIR/calls.log"
record_env() {
  env | grep -E '^(DATABASE_URL|DATABASE_URL_UNPOOLED|NEXT_PUBLIC_APP_ENV|NEXT_PUBLIC_APP_URL|E2E_DISABLE_RATE_LIMIT|SIGNUP_TIMING_LOG|E2E_LOCAL_PORT|CRON_SECRET|SEED_TEST_USERS|SMOKE_TEST_[A-Z]+|FORGOT_PASSWORD_TEST_[A-Z]+)=' | sort > "$STUB_DIR/\${1:-server}.env"
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
  "install --frozen-lockfile") [ "\${STUB_FAIL_STEP:-}" != install ] || exit 1 ;;
  "db:generate") [ "\${STUB_FAIL_STEP:-}" != generate ] || exit 1 ;;
  "exec playwright install --dry-run chromium")
    printf '  Install location:    %s\n' "$STUB_DIR/browsers/chromium-1" "$STUB_DIR/browsers/ffmpeg-1" ;;
  "exec playwright install chromium")
    [ "\${STUB_FAIL_STEP:-}" != chromium ] || exit 1
    mkdir -p "$STUB_DIR/browsers/chromium-1" && touch "$STUB_DIR/browsers/chromium-1/INSTALLATION_COMPLETE" ;;
  "exec playwright "*) record_env ;;
  "exec tsx "*"/scripts/print-seed-test-user-defaults.ts")
    [ "\${STUB_FAIL_STEP:-}" != defaults ] || exit 1
    printf '%s\n' SMOKE_TEST_EMAIL=default-smoke@test SMOKE_TEST_PASSWORD=default-smoke-pass \
      FORGOT_PASSWORD_TEST_EMAIL=default-forgot@test FORGOT_PASSWORD_TEST_PASSWORD=default-forgot-pass ;;
  "db:seed") echo "$DATABASE_URL" > "$STUB_DIR/seed.db"; record_env seed ;;
esac
`

const CURL_STUB = `#!/usr/bin/env bash
for arg; do url="$arg"; done
echo "curl $url" >> "$STUB_DIR/calls.log"
if [ -e "$STUB_DIR/server-up" ]; then printf 200; else printf 000; exit 7; fi
`

export let root: string
export let stubDir: string

/** A scratch repo root per test, with stub `pnpm` and `curl` on PATH. */
export function setupScratchRepo() {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-local-'))
    stubDir = path.join(root, 'stub')
    const bin = path.join(root, 'bin')
    fs.mkdirSync(path.join(root, 'scripts'))
    fs.mkdirSync(stubDir)
    fs.mkdirSync(bin)
    for (const file of [
      'e2e-local.sh',
      'e2e-local-toolchain.sh',
      'e2e-branch-liveness.sh',
      'e2e-local-seed.sh',
    ]) {
      fs.copyFileSync(path.join(scriptsDir, file), path.join(root, 'scripts', file))
    }
    writeToolchain()
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
}

/** Older than any output, so a fresh fixture needs no toolchain step. */
const INPUT_TIME = new Date('2026-01-01T00:00:00Z')
const OUTPUT_TIME = new Date('2026-01-02T00:00:00Z')

export const LOCKFILE = 'pnpm-lock.yaml'
export const MODULES = 'node_modules/.modules.yaml'
export const SCHEMA = 'prisma/schema.prisma'
export const CLIENT = 'src/generated/prisma/client.ts'

export function touch(relative: string, time: Date) {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '')
  fs.utimesSync(file, time, time)
}

/** An up-to-date checkout: outputs newer than inputs, Chromium installed. */
function writeToolchain() {
  touch(LOCKFILE, INPUT_TIME)
  touch(MODULES, OUTPUT_TIME)
  touch(SCHEMA, INPUT_TIME)
  touch(CLIENT, OUTPUT_TIME)
  for (const browser of ['chromium-1', 'ffmpeg-1']) {
    touch(path.join('stub', 'browsers', browser, 'INSTALLATION_COMPLETE'), OUTPUT_TIME)
  }
}

/**
 * A clean environment: nothing inherited from vitest's own env block, which sets
 * NEXT_PUBLIC_APP_ENV and would mask what the script exports.
 */
export function stubEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    PATH: `${path.join(root, 'bin')}:${process.env.PATH ?? ''}`,
    HOME: root,
    STUB_DIR: stubDir,
    ...extra,
  }
}

export function run(args: string[], extra: Record<string, string> = {}) {
  const result = spawnSync('bash', [path.join(root, 'scripts', 'e2e-local.sh'), ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    env: stubEnv(extra),
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

export const calls = () => {
  const file = path.join(stubDir, 'calls.log')
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

/** The environment the stub dev server (or Playwright, or the seed) was started with. */
export function serverEnv(name: 'server' | 'seed' = 'server'): Map<string, string> {
  const lines = fs
    .readFileSync(path.join(stubDir, `${name}.env`), 'utf8')
    .trim()
    .split('\n')
  return new Map(
    lines.map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  )
}
