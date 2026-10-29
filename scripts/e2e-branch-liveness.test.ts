/**
 * `scripts/e2e-branch-liveness.sh` — when an `e2e-local-*` Neon branch is dead
 * (HON-1415). Sources the real file under `set -euo pipefail`, as e2e-local.sh
 * does, with `hostname` and `ps` stubbed on PATH. The stub `ps` prints
 * `$STUB_DIR/ps-<pid>` when it exists, fails when `STUB_PS_BROKEN` is set, and
 * otherwise asks the real `ps` (the rule checks that ps can see its own shell).
 * HOME is the stub dir, which holds the machine id 123456.
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
    [
      '#!/bin/sh',
      '[ -f "$STUB_DIR/ps-$2" ] && exec cat "$STUB_DIR/ps-$2"',
      '[ -n "$STUB_PS_BROKEN" ] && exit 1',
      'exec /bin/ps "$@"',
      '',
    ].join('\n'),
    { mode: 0o755 },
  )
  writeId(stubDir, '123456')
})

function writeId(home: string, id: string) {
  fs.mkdirSync(path.join(home, '.config', 'wobblepot'), { recursive: true })
  fs.writeFileSync(path.join(home, '.config', 'wobblepot', 'e2e-host-id'), `${id}\n`)
}

afterEach(() => {
  fs.rmSync(stubDir, { recursive: true, force: true })
})

function sh(script: string, args: string[], host = 'MyMac-2', extra = {}) {
  return spawnSync('bash', ['-c', `set -euo pipefail; source "${lib}"; ${script}`, '_', ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      NODE_ENV: 'test',
      PATH: `${stubDir}:${process.env.PATH ?? ''}`,
      STUB_DIR: stubDir,
      STUB_HOST: host,
      HOME: stubDir,
      ...extra,
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

const tag = (host: string, extra = {}) => sh('e2e_local_host_tag', [], host, extra).stdout.trim()

describe('e2e_local_host_tag', () => {
  it('joins 6 characters of the hostname, lower-case [a-z0-9] only, and the machine id', () => {
    expect(tag('MyMac-2')).toBe('mymac2123456')
    expect(tag('Kaupos-MacBook-Pro')).toBe('kaupos123456')
  })

  // Two Macs called MacBook-Pro would each delete the other's live branch.
  it('gives two machines with the same hostname different tags', () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-liveness-home-'))
    writeId(other, '654321')

    expect(tag('MacBook-Pro')).toBe('macboo123456')
    expect(tag('MacBook-Pro', { HOME: other })).toBe('macboo654321')
    fs.rmSync(other, { recursive: true, force: true })
  })

  it('makes the machine id once and then reuses it', () => {
    fs.rmSync(path.join(stubDir, '.config'), { recursive: true })
    const first = tag('MyMac-2')
    const id = fs.readFileSync(path.join(stubDir, '.config', 'wobblepot', 'e2e-host-id'), 'utf8')

    expect(id).toMatch(/^\d{6}\n$/)
    expect(first).toBe(`mymac2${id.trim()}`)
    expect(tag('MyMac-2')).toBe(first)
  })

  it('is the machine id alone when the hostname leaves nothing', () => {
    expect(tag('---')).toBe('123456')
  })
})

describe('e2e_local_branch_dead', () => {
  describe('this host', () => {
    const name = 'e2e-local-mymac2123456-20261028-114144-58645'

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

    it('keeps it when ps cannot run, because the pid cannot be proved gone', () => {
      const r = sh(
        'e2e_local_branch_dead "$@" && echo dead || echo alive',
        [name, '', '', '2'],
        'MyMac-2',
        {
          STUB_PS_BROKEN: '1',
        },
      )

      expect(r.stdout.trim()).toBe('alive')
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
    const name = 'e2e-local-kept-mymac2123456-20261028-114144-58645'

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

    // GNU date (CI's Linux) reads "" as today's midnight and takes free text,
    // where BSD date on macOS fails. This stub answers every -d like GNU does.
    it('keeps it on GNU date too, when created_at is empty or free text', () => {
      const gnuDate = '#!/bin/sh\ncase "$*" in *-d*) echo 1 ;; *) /bin/date "$@" ;; esac\n'
      fs.writeFileSync(path.join(stubDir, 'date'), gnuDate, { mode: 0o755 })

      expect(dead(name, '')).toBe(false)
      expect(dead(name, 'yesterday')).toBe(false)
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
