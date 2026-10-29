/**
 * The head check and the fast settle in scripts/ci-settle.sh (HON-1407).
 *
 * Chunk 1 polls the PR's headRefOid until it equals the local HEAD, so a poll
 * right after a push cannot read the previous commit's finished checks. Once the
 * head matches, one poll settles when the ci.yml job finished 60 s or more ago;
 * otherwise the two-poll rule of ci-settle-gate.test.ts applies.
 *
 * `gh`, `git` and `sleep` are stubbed on PATH. `gh pr view` replays a list of
 * heads, one per call, and both `gh` subcommands log to one file, so a test can
 * assert the order of head checks and polls.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ciSettle = path.join(repoRoot, 'scripts/ci-settle.sh')

const CI_JOB = 'Lint, Type Check & Test'
const OLD = 'a'.repeat(40)
const NEW = 'b'.repeat(40)

type Check = { name: string; bucket: string; workflow: string; completedAt: string }

/** An ISO timestamp `seconds` in the past, in the whole-second form GitHub returns. */
const ago = (seconds: number) =>
  new Date(Date.now() - seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')

/** The ci.yml job, passed `seconds` ago, and a Vercel status stuck at pending. */
const greenChecks = (seconds: number): Check[] => [
  { name: CI_JOB, bucket: 'pass', workflow: 'CI', completedAt: ago(seconds) },
  { name: 'Vercel', bucket: 'pending', workflow: '', completedAt: '0001-01-01T00:00:00Z' },
]

describe('scripts/ci-settle.sh head check and fast settle', () => {
  let stubBin: string
  let callLog: string
  let viewCount: string
  // Far above any real PR, and apart from ci-settle-gate.test.ts's 990000 range,
  // because the two files may run at once and the state lives in /tmp by PR number.
  let prNumber = 995000

  beforeAll(() => {
    stubBin = fs.mkdtempSync(path.join(os.tmpdir(), 'hon1407-bin-'))
    callLog = path.join(stubBin, 'calls')
    viewCount = path.join(stubBin, 'view-count')

    // `pr view` prints the Nth of $STUB_HEADS (space-separated), the last one once
    // the list runs out. `pr checks` prints $STUB_CHECKS through --jq, if any.
    fs.writeFileSync(
      path.join(stubBin, 'gh'),
      [
        '#!/bin/sh',
        'case "$2" in',
        '  view)',
        `    echo view >> ${JSON.stringify(callLog)}`,
        `    n=$(( $(cat ${JSON.stringify(viewCount)} 2>/dev/null || echo 0) + 1 ))`,
        `    echo "$n" > ${JSON.stringify(viewCount)}`,
        '    set -- $STUB_HEADS; [ "$n" -gt $# ] && n=$#; eval "echo \\${$n}"',
        '    ;;',
        '  checks)',
        `    echo checks >> ${JSON.stringify(callLog)}`,
        '    jq_expr=""',
        '    while [ $# -gt 0 ]; do [ "$1" = "--jq" ] && jq_expr="$2"; shift; done',
        '    printf \'%s\' "$STUB_CHECKS" | jq -r "${jq_expr:-.}"',
        '    ;;',
        'esac',
        '',
      ].join('\n'),
      { mode: 0o755 },
    )
    fs.writeFileSync(path.join(stubBin, 'git'), '#!/bin/sh\necho "$STUB_LOCAL"\n', { mode: 0o755 })
    fs.writeFileSync(path.join(stubBin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  })

  afterAll(() => fs.rmSync(stubBin, { recursive: true, force: true }))

  afterEach(() => {
    fs.rmSync(`/tmp/ci-poll-${prNumber}.prev`, { force: true })
    fs.rmSync(`/tmp/ci-poll-${prNumber}.chunks`, { force: true })
  })

  /** Run chunk 1 on a fresh PR number. Returns the marker and the `gh` call log. */
  function runChunk(heads: string[], checks: Check[]) {
    prNumber += 1
    fs.rmSync(`/tmp/ci-poll-${prNumber}.prev`, { force: true })
    fs.rmSync(`/tmp/ci-poll-${prNumber}.chunks`, { force: true })
    fs.rmSync(callLog, { force: true })
    fs.rmSync(viewCount, { force: true })

    const out = execFileSync('bash', [ciSettle, String(prNumber)], {
      encoding: 'utf8',
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${stubBin}:${process.env.PATH}`,
        STUB_HEADS: heads.join(' '),
        STUB_LOCAL: NEW,
        STUB_CHECKS: JSON.stringify(checks),
      },
    })
    const calls = fs.readFileSync(callLog, 'utf8').trim().split('\n')
    return {
      marker: out.trim().split('\n').pop() ?? '',
      calls,
      polls: calls.filter((call) => call === 'checks').length,
    }
  }

  it('settles on the first poll when the head matches and the job finished 5 min ago', () => {
    const { marker, calls } = runChunk([NEW], greenChecks(300))

    expect(marker).toBe('CI_SETTLED')
    expect(calls).toEqual(['view', 'checks'])
  })

  it('needs a second identical poll when the job finished only 10 s ago', () => {
    const { marker, polls } = runChunk([NEW], greenChecks(10))

    expect(marker).toBe('CI_SETTLED')
    expect(polls).toBe(2)
  })

  // The old commit's checks are all green, so a poll before the head moves would
  // settle on the wrong commit. The stub serves the same green list throughout.
  it('polls no check before the PR head equals the local HEAD', () => {
    const { marker, calls } = runChunk([OLD, OLD, NEW], greenChecks(300))

    expect(calls).toEqual(['view', 'view', 'view', 'checks'])
    expect(marker).toBe('CI_SETTLED')
  })

  it('falls back to the two-poll rule after 30 s with no head match', () => {
    const { marker, calls, polls } = runChunk([OLD], greenChecks(300))

    expect(calls.slice(0, 10)).toEqual(Array(10).fill('view'))
    expect(calls.filter((call) => call === 'view')).toHaveLength(10)
    expect(marker).toBe('CI_SETTLED')
    expect(polls).toBe(2)
  })

  it('does not fast-settle while another Actions job is pending', () => {
    const checks = [
      ...greenChecks(300),
      { name: 'E2E', bucket: 'pending', workflow: 'CI', completedAt: '0001-01-01T00:00:00Z' },
    ]
    const { marker } = runChunk([NEW], checks)

    expect(marker).toBe('CI_WAITING (chunk 1/6)')
  })
})
