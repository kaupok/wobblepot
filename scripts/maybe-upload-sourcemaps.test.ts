/**
 * `scripts/maybe-upload-sourcemaps.sh` — the PostHog source map upload (HON-997).
 *
 * Runs the real script against a scratch dist dir with `pnpm` stubbed on PATH,
 * so nothing here reaches PostHog. The stub logs every call and prints the
 * upload summary the test asks for, in the CLI 0.18.9 log format.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'maybe-upload-sourcemaps.sh')

const PNPM_STUB = `#!/usr/bin/env bash
echo "pnpm $*" >> "$STUB_DIR/calls.log"
case "$*" in
  *" sourcemap inject "*) exit "\${STUB_INJECT_RC:-0}" ;;
  *" sourcemap upload "*)
    if [ -n "\${STUB_SUMMARY:-}" ]; then
      printf '\\033[2m2026-10-02T21:28:58Z\\033[0m \\033[32m INFO\\033[0m posthog_cli::api::symbol_sets: %s\\n' "$STUB_SUMMARY" >&2
    fi
    exit "\${STUB_UPLOAD_RC:-0}" ;;
esac
`

const GATE_ENV = {
  VERCEL_GIT_COMMIT_SHA: 'abc123',
  POSTHOG_CLI_API_KEY: 'phx_test',
  POSTHOG_CLI_HOST: 'https://eu.posthog.com',
  POSTHOG_CLI_PROJECT_ID: '1',
}

let root: string
let stubDir: string
let distDir: string
let bin: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-sourcemaps-'))
  stubDir = path.join(root, 'stub')
  distDir = path.join(root, '.next')
  bin = path.join(root, 'bin')
  fs.mkdirSync(stubDir)
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'pnpm'), PNPM_STUB, { mode: 0o755 })
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function writeChunks(rel: string) {
  const dir = path.join(distDir, rel)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'a1.js'), '//# sourceMappingURL=b2.js.map\n')
  fs.writeFileSync(path.join(dir, 'b2.js.map'), '{"version":3}')
  return dir
}

function run(env: Record<string, string> = {}) {
  const result = spawnSync('bash', [script, distDir], {
    cwd: root,
    encoding: 'utf8',
    // A clean env: the real POSTHOG_CLI_* / VERCEL_* of the host must not leak in.
    env: {
      NODE_ENV: 'test',
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      HOME: root,
      STUB_DIR: stubDir,
      ...env,
    },
  })
  const callsLog = path.join(stubDir, 'calls.log')
  const calls = fs.existsSync(callsLog) ? fs.readFileSync(callsLog, 'utf8').trim().split('\n') : []
  return { status: result.status, out: result.stdout + result.stderr, calls }
}

function mapsUnder(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.map'))
}

const UPLOADED = 'Upload summary: 3 chunk(s) uploaded, 0 skipped (0 already present, 0 too large)'

describe('maybe-upload-sourcemaps.sh', () => {
  it('skips with exit 0 when the gate env vars are unset', () => {
    writeChunks('static/chunks')
    const { status, out, calls } = run()
    expect(status).toBe(0)
    expect(out).toContain('maybe-upload-sourcemaps: skip')
    expect(calls).toEqual([])
    expect(mapsUnder(distDir)).toHaveLength(1)
  })

  it('fails when the gate passes but there is no chunks directory', () => {
    fs.mkdirSync(path.join(distDir, 'static'), { recursive: true })
    const { status, out, calls } = run(GATE_ENV)
    expect(status).toBe(1)
    expect(out).toContain('static/chunks after compile')
    expect(calls).toEqual([])
  })

  it('fails when the chunks directory holds no maps', () => {
    const dir = path.join(distDir, 'static/chunks')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'a1.js'), '')
    const { status, out } = run(GATE_ENV)
    expect(status).toBe(1)
    expect(out).toContain('no .map files')
  })

  it('fails on immutable chunks, which Vercel would serve from an older build', () => {
    writeChunks('static/chunks')
    writeChunks('static/immutable/chunks')
    const { status, out, calls } = run({ ...GATE_ENV, STUB_SUMMARY: UPLOADED })
    expect(status).toBe(1)
    expect(out).toContain('Set supportsImmutableAssets: false')
    expect(calls).toEqual([])
    expect(mapsUnder(distDir)).toHaveLength(2)
  })

  it('injects and uploads with the same release, then deletes every map', () => {
    const chunks = writeChunks('static/chunks')
    const { status, out, calls } = run({ ...GATE_ENV, STUB_SUMMARY: UPLOADED })
    expect(status).toBe(0)
    const release = '--release-name honkadori --release-version abc123 --release-mode symbol-set'
    expect(calls[0]).toMatch(
      /^pnpm dlx @posthog\/cli@[\d.]+ --host https:\/\/eu\.posthog\.com sourcemap inject /,
    )
    expect(calls[0]).toContain(`--directory ${chunks} `)
    expect(calls[0]).toContain(release)
    expect(calls[1]).toContain(' sourcemap upload ')
    expect(calls[1]).toContain(`--directory ${chunks} `)
    expect(calls[1]).toContain('--delete-after')
    expect(calls[1]).toContain(release)
    // The CLI output reaches the build log.
    expect(out).toContain(UPLOADED)
    expect(out).toContain('done (3 uploaded, 0 already present')
    expect(mapsUnder(distDir)).toEqual([])
  })

  it('accepts a rebuild whose symbol sets are all already present', () => {
    writeChunks('static/chunks')
    const { status } = run({
      ...GATE_ENV,
      STUB_SUMMARY:
        'Upload summary: 0 chunk(s) uploaded, 3 skipped (3 already present, 0 too large)',
    })
    expect(status).toBe(0)
  })

  it('fails and keeps the maps when PostHog reports nothing uploaded', () => {
    writeChunks('static/chunks')
    const { status, out } = run({
      ...GATE_ENV,
      STUB_SUMMARY:
        'Upload summary: 0 chunk(s) uploaded, 2 skipped (0 already present, 2 too large)',
    })
    expect(status).toBe(1)
    expect(out).toContain('PostHog reports no symbol set for this build')
    expect(mapsUnder(distDir)).toHaveLength(1)
  })

  it('fails and keeps the maps when the CLI prints no summary', () => {
    writeChunks('static/chunks')
    const { status, out } = run(GATE_ENV)
    expect(status).toBe(1)
    expect(out).toContain('printed no upload summary')
    expect(mapsUnder(distDir)).toHaveLength(1)
  })

  it('fails when the upload exits non-zero, even after printing a summary', () => {
    writeChunks('static/chunks')
    const { status } = run({ ...GATE_ENV, STUB_SUMMARY: UPLOADED, STUB_UPLOAD_RC: '1' })
    expect(status).toBe(1)
    expect(mapsUnder(distDir)).toHaveLength(1)
  })

  it('stops before uploading when inject fails', () => {
    writeChunks('static/chunks')
    const { status, calls } = run({ ...GATE_ENV, STUB_INJECT_RC: '1' })
    expect(status).toBe(1)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain(' sourcemap inject ')
  })
})
