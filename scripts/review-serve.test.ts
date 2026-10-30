/**
 * `scripts/review-serve.sh` — the review server for one issue, as
 * `/implement-issue` → "Drive changed screens" runs it.
 *
 * Runs the real script from a scratch git checkout with `e2e-local.sh` and
 * `curl` stubbed, so nothing here touches Neon or a port. The stub server
 * records the arguments and port it was started with, prints the ready marker
 * after an optional delay, and marks a file when it is TERMed.
 */
import { ChildProcess, execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const realScript = path.join(scriptsDir, 'review-serve.sh')

const SERVE_STUB = `#!/usr/bin/env bash
echo "serve-args: $*" > "$STUB_DIR/serve.log"
echo "port: \${REVIEW_LOCAL_PORT:-unset}" >> "$STUB_DIR/serve.log"
trap 'touch "$STUB_DIR/stopped"; exit 0' TERM
# A server still in migrate or seed: bash defers the trap until the child exits.
if [ -n "\${STUB_IGNORE_TERM:-}" ]; then trap '' TERM; fi
if [ -n "\${STUB_EXIT_EARLY:-}" ]; then echo "ERROR: branches limit exceeded" >&2; exit 1; fi
sleep "\${STUB_READY_DELAY:-0}"
printf 'REVIEW-READY http://localhost:%s db=env\\n' "$REVIEW_LOCAL_PORT"
if [ -n "\${STUB_EXIT_AFTER_READY:-}" ]; then echo "ERROR: port taken" >&2; exit 1; fi
# Another server's READY, then ours dies: the case the settle window exists for.
if [ -n "\${STUB_DIE_AFTER:-}" ]; then sleep "$STUB_DIE_AFTER"; echo "ERROR: port taken" >&2; exit 1; fi
sleep 60 & wait $!
`

// Every port refuses (curl exit 7) unless STUB_BUSY_PORTS names it (answers) or
// STUB_SLOW_PORTS names it (listens but times out, curl exit 28).
const CURL_STUB = `#!/usr/bin/env bash
for arg; do url="$arg"; done
port="\${url##*:}"; port="\${port%%/*}"
case " \${STUB_BUSY_PORTS:-} " in *" $port "*) exit 0 ;; esac
case " \${STUB_SLOW_PORTS:-} " in *" $port "*) exit 28 ;; esac
exit 7
`

let root: string
let stubDir: string
let script: string
let children: ChildProcess[]

function write(file: string, content: string, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, { mode })
}

function env(extra: Record<string, string> = {}) {
  return {
    ...process.env,
    PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
    STUB_DIR: stubDir,
    REVIEW_SERVE_DIR: stubDir,
    REVIEW_SERVE_WAIT_SECS: '3',
    REVIEW_SERVE_POLL_SECS: '0.2',
    REVIEW_SERVE_SETTLE_SECS: '0',
    ...extra,
  }
}

// Async, not spawnSync: a blocked event loop never reaps an exited `start`
// child, and `kill -0` on the zombie keeps reporting it alive.
function run(args: string[], extra: Record<string, string> = {}, cwd = root) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn('bash', [script, ...args], { cwd, env: env(extra) })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

function start(args: string[], extra: Record<string, string> = {}, cwd = root) {
  const child = spawn('bash', [script, 'start', ...args], { cwd, env: env(extra) })
  children.push(child)
  return child
}

async function until(check: () => boolean, ms = 5000) {
  const deadline = Date.now() + ms
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 50))
  }
}

const pidFile = () => path.join(stubDir, 'review-hon-9.pid')
const logFile = () => path.join(stubDir, 'review-hon-9.log')
const serveLog = () => fs.readFileSync(path.join(stubDir, 'serve.log'), 'utf8')

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-serve-'))
  stubDir = path.join(root, 'stub')
  fs.mkdirSync(stubDir)
  children = []
  execFileSync('git', ['init', '-q', root])
  script = path.join(root, 'scripts', 'review-serve.sh')
  write(script, fs.readFileSync(realScript, 'utf8'), 0o755)
  write(path.join(root, 'scripts', 'e2e-local.sh'), SERVE_STUB, 0o755)
  write(path.join(root, 'bin', 'curl'), CURL_STUB, 0o755)
  write(path.join(root, '.env'), 'DATABASE_URL=postgres://shared\n')
})

afterEach(async () => {
  for (const child of children) child.kill('SIGTERM')
  await until(
    () => children.every((c) => c.exitCode !== null || c.signalCode !== null),
    3000,
  ).catch(() => undefined)
  fs.rmSync(root, { recursive: true, force: true })
})

// The tests above shorten every window. The defaults are what the skill
// promises: a wait chunk under the 540 s foreground cap, a 5 s settle, 30 s to stop.
it('keeps the documented defaults', () => {
  const source = fs.readFileSync(realScript, 'utf8')
  expect(source).toContain('WAIT_SECS="${REVIEW_SERVE_WAIT_SECS:-480}"')
  expect(source).toContain('SETTLE_SECS="${REVIEW_SERVE_SETTLE_SECS:-5}"')
  expect(source).toContain('STOP_SECS="${REVIEW_SERVE_STOP_SECS:-30}"')
})

describe('review-serve.sh start', () => {
  it('runs serve in branch mode on the one free 32xx port, with --seed passed through', async () => {
    // Every port but 3299 is busy, so a broken busy-port skip picks another one.
    const busy = Array.from({ length: 98 }, (_, i) => 3201 + i).join(' ')
    start(['HON-9', '--seed'], { STUB_BUSY_PORTS: busy })
    await until(
      () => fs.existsSync(logFile()) && /REVIEW-READY/.test(fs.readFileSync(logFile(), 'utf8')),
    )
    const log = serveLog()
    expect(log).toContain('serve-args: serve --seed\n')
    expect(log).toContain('port: 3299\n')
    expect(fs.readFileSync(logFile(), 'utf8')).toContain('REVIEW-READY http://localhost:3299')
    // The pid file holds the server process itself, so stop reaches it.
    const pid = Number(fs.readFileSync(pidFile(), 'utf8'))
    expect(() => process.kill(pid, 0)).not.toThrow()
  })

  it('skips a port whose listener is slow to answer, not only one that answers', async () => {
    const busy = Array.from({ length: 97 }, (_, i) => 3201 + i).join(' ') // 3201–3297
    start(['HON-9'], { STUB_BUSY_PORTS: busy, STUB_SLOW_PORTS: '3298' })
    await until(
      () => fs.existsSync(logFile()) && /REVIEW-READY/.test(fs.readFileSync(logFile(), 'utf8')),
    )
    expect(serveLog()).toContain('port: 3299\n')
  })

  it('uses --db env when the worktree .env has its own DATABASE_URL', async () => {
    // CI has no git identity, so the commit names one inline.
    execFileSync('git', [
      '-C',
      root,
      '-c',
      'user.name=review-serve test',
      '-c',
      'user.email=review-serve@example.com',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'init',
    ])
    const wt = path.join(root, 'wt')
    execFileSync('git', ['-C', root, 'worktree', 'add', '-q', wt])
    write(path.join(wt, '.env'), 'DATABASE_URL=postgres://own\n')
    write(path.join(wt, 'scripts', 'review-serve.sh'), fs.readFileSync(realScript, 'utf8'), 0o755)
    write(path.join(wt, 'scripts', 'e2e-local.sh'), SERVE_STUB, 0o755)
    const child = spawn('bash', [path.join(wt, 'scripts', 'review-serve.sh'), 'start', 'HON-9'], {
      cwd: wt,
      env: env(),
    })
    children.push(child)
    await until(() => fs.existsSync(path.join(stubDir, 'serve.log')))
    expect(serveLog()).toContain('serve-args: serve --db env\n')
  })

  it('refuses a second server for the same issue', async () => {
    start(['HON-9'])
    await until(
      () => fs.existsSync(logFile()) && /REVIEW-READY/.test(fs.readFileSync(logFile(), 'utf8')),
    )
    const second = await run(['start', 'HON-9'])
    expect(second.status).toBe(1)
    expect(second.stderr).toContain('already running')
  })

  it('rejects an unknown argument and a malformed issue id', async () => {
    expect((await run(['start', 'HON-9', '--db', 'env'])).status).toBe(2)
    expect((await run(['start', 'HON-9;rm'])).status).toBe(2)
    expect((await run(['start'])).status).toBe(2)
  })
})

describe('review-serve.sh wait', () => {
  it('prints the ready line once the server answers and stays alive', async () => {
    start(['HON-9'], { STUB_READY_DELAY: '0.5' })
    await until(() => fs.existsSync(pidFile()))
    const result = await run(['wait', 'HON-9'])
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/^REVIEW-READY http:\/\/localhost:3\d{3} db=env\n$/)
  })

  it('prints REVIEW_FAILED with the log tail when the server exits', async () => {
    start(['HON-9'], { STUB_EXIT_EARLY: '1' })
    await until(() => fs.existsSync(pidFile()))
    const result = await run(['wait', 'HON-9'])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('ERROR: branches limit exceeded')
    expect(result.stdout.trim().endsWith('REVIEW_FAILED')).toBe(true)
  })

  it('prints REVIEW_FAILED when the server is dead by the time wait reads READY', async () => {
    start(['HON-9'], { STUB_EXIT_AFTER_READY: '1' })
    await until(
      () => fs.existsSync(logFile()) && /REVIEW-READY/.test(fs.readFileSync(logFile(), 'utf8')),
    )
    const result = await run(['wait', 'HON-9'], { REVIEW_SERVE_SETTLE_SECS: '0' })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('ERROR: port taken')
    expect(result.stdout.trim().endsWith('REVIEW_FAILED')).toBe(true)
  })

  // The server prints READY, then dies 0.5 s later. `wait` starts before READY,
  // so only the settle window separates the two outcomes: with no settle it
  // reports the READY of a server that is about to die.
  it('prints REVIEW_FAILED when the server dies inside the settle window after READY', async () => {
    start(['HON-9'], { STUB_READY_DELAY: '0.3', STUB_DIE_AFTER: '0.5' })
    await until(() => fs.existsSync(pidFile()))
    const result = await run(['wait', 'HON-9'], { REVIEW_SERVE_SETTLE_SECS: '1' })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('ERROR: port taken')
    expect(result.stdout.trim().endsWith('REVIEW_FAILED')).toBe(true)
  })

  it('prints READY for that same server with no settle window', async () => {
    start(['HON-9'], { STUB_READY_DELAY: '0.3', STUB_DIE_AFTER: '0.5' })
    await until(() => fs.existsSync(pidFile()))
    const result = await run(['wait', 'HON-9'], { REVIEW_SERVE_SETTLE_SECS: '0' })
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/^REVIEW-READY http:\/\/localhost:3\d{3} db=env\n$/)
  })

  it('prints REVIEW_FAILED with the reason when start dies before the server runs', async () => {
    const busy = Array.from({ length: 99 }, (_, i) => 3201 + i).join(' ')
    start(['HON-9'], { STUB_BUSY_PORTS: busy })
    await until(() => fs.existsSync(pidFile()))
    const result = await run(['wait', 'HON-9'])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('no free port in 3201-3299')
    expect(result.stdout.trim().endsWith('REVIEW_FAILED')).toBe(true)
    expect(fs.existsSync(path.join(stubDir, 'serve.log'))).toBe(false)
  })

  it('prints REVIEW_WAITING when the deadline passes without a verdict', async () => {
    start(['HON-9'], { STUB_READY_DELAY: '30' })
    await until(() => fs.existsSync(pidFile()))
    const result = await run(['wait', 'HON-9'], { REVIEW_SERVE_WAIT_SECS: '1' })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('REVIEW_WAITING\n')
  })
})

describe('review-serve.sh stop', () => {
  it('TERMs the recorded server and removes the pid file', async () => {
    start(['HON-9'])
    await until(
      () => fs.existsSync(logFile()) && /REVIEW-READY/.test(fs.readFileSync(logFile(), 'utf8')),
    )
    const result = await run(['stop', 'HON-9'])
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('review server for hon-9 stopped\n')
    expect(fs.existsSync(path.join(stubDir, 'stopped'))).toBe(true)
    expect(fs.existsSync(pidFile())).toBe(false)
    expect(fs.existsSync(logFile())).toBe(false)
  })

  it('keeps the files and fails when the server outlives the stop window', async () => {
    start(['HON-9'], { STUB_IGNORE_TERM: '1' })
    await until(
      () => fs.existsSync(logFile()) && /REVIEW-READY/.test(fs.readFileSync(logFile(), 'utf8')),
    )
    const result = await run(['stop', 'HON-9'], { REVIEW_SERVE_STOP_SECS: '1' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('did not exit within 1 s; run stop again')
    expect(fs.existsSync(pidFile())).toBe(true)
    expect(fs.existsSync(logFile())).toBe(true)
  })

  it('is a no-op without a recorded server', async () => {
    const result = await run(['stop', 'HON-9'])
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('no review server recorded')
  })
})
