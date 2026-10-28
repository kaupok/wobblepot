/**
 * `pnpm test:e2e:local gc` — deletes the dead `e2e-local-*` branches (HON-1415).
 *
 * Runs the real script from a scratch repo root with `pnpm`, `hostname` and
 * `ps` stubbed on PATH. The stub `pnpm` answers `branches list` with
 * `$STUB_DIR/branches.json` and logs every call, so "deleted" is an assertion
 * on that log. The stub `ps` answers for a pid only when `$STUB_DIR/ps-<pid>`
 * exists. The rule itself is tested in e2e-branch-liveness.test.ts.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))

const STUBS = {
  pnpm: `#!/usr/bin/env bash
echo "pnpm $*" >> "$STUB_DIR/calls.log"
case "$*" in
  "dlx neonctl@"*" branches list "*) cat "$STUB_DIR/branches.json" ;;
esac
`,
  hostname: '#!/bin/sh\necho buildbox\n',
  ps: '#!/bin/sh\n[ -f "$STUB_DIR/ps-$2" ] || exit 1\ncat "$STUB_DIR/ps-$2"\n',
}

let root: string
let stubDir: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-local-gc-'))
  stubDir = path.join(root, 'stub')
  fs.mkdirSync(path.join(root, 'scripts'))
  fs.mkdirSync(stubDir)
  fs.mkdirSync(path.join(root, 'bin'))
  for (const file of ['e2e-local.sh', 'e2e-local-toolchain.sh', 'e2e-branch-liveness.sh']) {
    fs.copyFileSync(path.join(scriptsDir, file), path.join(root, 'scripts', file))
  }
  fs.writeFileSync(path.join(root, '.env'), 'NEON_API_KEY=neon-key\nNEON_PROJECT_ID=neon-project\n')
  for (const [name, body] of Object.entries(STUBS)) {
    fs.writeFileSync(path.join(root, 'bin', name), body, { mode: 0o755 })
  }
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

function gc(branches: object[]) {
  fs.writeFileSync(path.join(stubDir, 'branches.json'), JSON.stringify(branches))
  const result = spawnSync('bash', [path.join(root, 'scripts', 'e2e-local.sh'), 'gc'], {
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      NODE_ENV: 'test',
      PATH: `${path.join(root, 'bin')}:${process.env.PATH ?? ''}`,
      HOME: root,
      STUB_DIR: stubDir,
    },
  })
  const log = fs.readFileSync(path.join(stubDir, 'calls.log'), 'utf8')
  const deleted = [...log.matchAll(/branches delete (\S+)/g)].map((m) => m[1])
  return { ...result, deleted }
}

describe('e2e-local.sh gc', () => {
  it('deletes an old-format branch created 3 h ago that Neon touched a minute ago', () => {
    const { status, deleted } = gc([
      {
        id: 'br-1',
        name: 'e2e-local-20261028-114144-58645',
        created_at: hoursAgo(3),
        updated_at: hoursAgo(0.02),
      },
    ])

    expect(status).toBe(0)
    expect(deleted).toEqual(['e2e-local-20261028-114144-58645'])
  })

  it('deletes a branch from this host whose process is gone, a minute after it was made', () => {
    const { deleted } = gc([
      { id: 'br-1', name: 'e2e-local-buildbox-20261028-150000-4242', created_at: hoursAgo(0.02) },
    ])

    expect(deleted).toEqual(['e2e-local-buildbox-20261028-150000-4242'])
  })

  it("never deletes a live run's branch, however old", () => {
    fs.writeFileSync(path.join(stubDir, 'ps-4242'), 'bash scripts/e2e-local.sh serve\n')
    const { stderr, deleted } = gc([
      { id: 'br-1', name: 'e2e-local-buildbox-20261028-010000-4242', created_at: hoursAgo(14) },
    ])

    expect(deleted).toEqual([])
    expect(stderr).toContain("GC: keeping 'e2e-local-buildbox-20261028-010000-4242'")
  })

  it("keeps another host's branch while it is younger than E2E_GC_MIN_AGE_HOURS", () => {
    const { deleted } = gc([
      { id: 'br-1', name: 'e2e-local-otherbox-20261028-150000-4242', created_at: hoursAgo(1) },
    ])

    expect(deleted).toEqual([])
  })
})
