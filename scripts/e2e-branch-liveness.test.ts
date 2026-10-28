/**
 * `scripts/e2e-branch-liveness.sh` — when an `e2e-local-*` Neon branch is dead
 * (HON-1415). Sources the real file under `set -euo pipefail`, as e2e-local.sh
 * does, with `hostname` and `ps` stubbed on PATH: the stub `ps` answers for a
 * pid only when `$STUB_DIR/ps-<pid>` exists, and prints that file's command.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const lib = path.join(path.dirname(fileURLToPath(import.meta.url)), 'e2e-branch-liveness.sh')

let stubDir: string

beforeEach(() => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-liveness-'))
  fs.writeFileSync(path.join(stubDir, 'hostname'), '#!/bin/sh\nprintf "%s\\n" "$STUB_HOST"\n', {
    mode: 0o755,
  })
  fs.writeFileSync(
    path.join(stubDir, 'ps'),
    '#!/bin/sh\n[ -f "$STUB_DIR/ps-$2" ] || exit 1\ncat "$STUB_DIR/ps-$2"\n',
    { mode: 0o755 },
  )
})

afterEach(() => {
  fs.rmSync(stubDir, { recursive: true, force: true })
})

function sh(script: string, args: string[], host = 'MyMac-2') {
  return spawnSync('bash', ['-c', `set -euo pipefail; source "${lib}"; ${script}`, '_', ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      NODE_ENV: 'test',
      PATH: `${stubDir}:${process.env.PATH ?? ''}`,
      STUB_DIR: stubDir,
      STUB_HOST: host,
    },
  })
}

function runs(pid: number, command: string) {
  fs.writeFileSync(path.join(stubDir, `ps-${pid}`), `${command}\n`)
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

/** True when the rule calls the branch dead, at the default 2 h gate. */
function dead(name: string, createdAt: string, updatedAt = createdAt, gate = '2'): boolean {
  const r = sh('if e2e_local_branch_dead "$@"; then echo dead; else echo alive; fi', [
    name,
    createdAt,
    updatedAt,
    gate,
  ])
  expect(r.status, r.stderr).toBe(0)
  return r.stdout.trim() === 'dead'
}

const tag = (host: string) => sh('e2e_local_host_tag', [], host).stdout.trim()

describe('e2e_local_host_tag', () => {
  it('lower-cases and keeps only [a-z0-9]', () => {
    expect(tag('MyMac-2')).toBe('mymac2')
  })

  it('keeps 6 characters of a longer name and adds 6 digits of its checksum', () => {
    expect(tag('MyMac-2.Local_Box')).toBe('mymac2891209')
  })

  // A plain 12-character cut gave both `kauposmacboo`, so each Mac read the
  // other's live branch as its own and deleted it.
  it('tells apart two names that differ only after the 12th character', () => {
    expect(tag('Kaupos-MacBook-Pro')).toBe('kaupos358228')
    expect(tag('Kaupos-MacBook-Air')).toBe('kaupos741621')
  })

  it('falls back to "host" when nothing is left', () => {
    expect(tag('---')).toBe('host')
  })
})

describe('e2e_local_branch_dead', () => {
  describe('this host', () => {
    const name = 'e2e-local-mymac2-20261028-114144-58645'

    it('keeps a branch whose pid still runs e2e-local.sh, at any age', () => {
      runs(58645, 'bash scripts/e2e-local.sh serve')

      expect(dead(name, hoursAgo(10))).toBe(false)
    })

    it('calls it dead when another program now holds the pid', () => {
      runs(58645, 'node server.js')

      expect(dead(name, hoursAgo(0.02))).toBe(true)
    })

    it('calls it dead when no process has the pid, however young', () => {
      expect(dead(name, hoursAgo(0.02))).toBe(true)
    })
  })

  describe('another host', () => {
    const name = 'e2e-local-otherbox-20261028-114144-58645'

    it('keeps it while it is younger than the gate, even when the pid is gone here', () => {
      expect(dead(name, hoursAgo(1))).toBe(false)
    })

    it('keeps a long-running review server that Neon saw active within the gate', () => {
      expect(dead(name, hoursAgo(5), hoursAgo(0.02))).toBe(false)
    })

    it('calls it dead once old and idle, even when the same pid runs e2e-local.sh here', () => {
      runs(58645, 'bash scripts/e2e-local.sh serve')

      expect(dead(name, hoursAgo(5), hoursAgo(3))).toBe(true)
    })
  })

  describe('a --keep branch', () => {
    const name = 'e2e-local-kept-mymac2-20261028-114144-58645'

    it('stays after its run exits until it is old and idle', () => {
      expect(dead(name, hoursAgo(0.5))).toBe(false)
      expect(dead(name, hoursAgo(5), hoursAgo(0.02))).toBe(false)
      expect(dead(name, hoursAgo(5), hoursAgo(3))).toBe(true)
    })
  })

  describe('old format, no host tag', () => {
    const name = 'e2e-local-20261028-114144-58645'

    it('goes by created_at alone', () => {
      expect(dead(name, hoursAgo(1), hoursAgo(5))).toBe(false)
      expect(dead(name, hoursAgo(3), hoursAgo(0.02))).toBe(true)
    })

    it('honours a different gate', () => {
      expect(dead(name, hoursAgo(3), hoursAgo(3), '5')).toBe(false)
    })

    it('keeps a branch whose created_at does not parse', () => {
      expect(dead(name, 'not a date')).toBe(false)
      expect(dead(name, '')).toBe(false)
    })
  })
})

describe('e2e_local_dead_branch_names', () => {
  it('ages from created_at, not updated_at, and reads only e2e-local-* names', () => {
    const json = JSON.stringify({
      branches: [
        {
          name: 'e2e-local-20261028-114144-1',
          created_at: hoursAgo(3),
          updated_at: hoursAgo(0.02),
        },
        { name: 'e2e-local-20261028-114144-2', created_at: hoursAgo(1), updated_at: hoursAgo(5) },
        { name: 'e2e-local-20261028-114144-3', updated_at: hoursAgo(5) },
        { name: 'auto--hon-1', created_at: hoursAgo(9) },
      ],
    })
    const r = sh('e2e_local_dead_branch_names "$1" 2', [json])

    expect(r.stdout.split('\n').filter(Boolean)).toEqual(['e2e-local-20261028-114144-1'])
    expect(r.stderr).toContain("GC: keeping 'e2e-local-20261028-114144-2'")
    expect(r.stderr).toContain("GC: keeping 'e2e-local-20261028-114144-3'")
  })
})
