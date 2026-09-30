import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * Drives `scripts/neon-cleanup.sh sweep` end to end with `curl`, `git` and
 * `gh` replaced by stubs on PATH, so the real jq expressions, gates and
 * summary run against fixture data without touching Neon, Linear or GitHub
 * (HON-852). `jq`, `date` and the rest of the toolchain are the real ones.
 */

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const neonCleanup = path.join(scriptsDir, 'neon-cleanup.sh')
const worktreeClaude = path.join(scriptsDir, 'worktree-claude.sh')

const OLD = '2026-01-01T00:00:00Z'
const young = () => new Date().toISOString()

type Branch = {
  id?: string
  name: string
  updated_at?: string
  default?: boolean
  /** Neon's deprecated spelling of `default`, still read as the fallback. */
  primary?: boolean
  protected?: boolean
  compute_time_seconds?: number
  written_data_bytes?: number
}

type Fixture = {
  branches: Branch[]
  /** Branch names that exist on origin (`refs/heads/<name>`). */
  remoteRefs?: string[]
  /** Head refs that have an open PR. */
  openPrHeads?: string[]
  /** Linear state type every issue lookup returns. */
  linearState?: string
  gitFails?: boolean
  ghFails?: boolean
  dryRun?: '0' | '1'
  minAgeHours?: string
}

const CURL_STUB = `#!/usr/bin/env bash
method=GET; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -X) method="$2"; shift 2 ;;
    -H|-d|-w|--max-time) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
echo "curl $method $url" >> "$STUB_DIR/calls"
case "$method $url" in
  "GET "*/branches) cat "$STUB_DIR/branches.json"; printf '\\n200' ;;
  "POST "*linear*) printf '{"data":{"issue":{"state":{"type":"%s"}}}}\\n200' "$STUB_LINEAR_STATE" ;;
  "DELETE "*) printf '{}\\n200' ;;
  *) printf 'unexpected\\n500' ;;
esac
`

// Mirrors `git ls-remote --exit-code`: exit 2 when nothing matches.
const GIT_STUB = `#!/usr/bin/env bash
echo "git $*" >> "$STUB_DIR/calls"
[ "$STUB_GIT_FAILS" = 1 ] && exit 128
[ "$1" = -C ] && shift 2
[ "$1" = ls-remote ] || exit 99
ref="\${!#}"
ref="\${ref#refs/heads/}"
grep -qxF "$ref" "$STUB_DIR/remote-refs" && { printf 'abc123\\trefs/heads/%s\\n' "$ref"; exit 0; }
exit 2
`

const GH_STUB = `#!/usr/bin/env bash
echo "gh $*" >> "$STUB_DIR/calls"
[ "$STUB_GH_FAILS" = 1 ] && exit 1
head=""
while [ $# -gt 0 ]; do
  case "$1" in --head) head="$2"; shift 2 ;; *) shift ;; esac
done
if grep -qxF "$head" "$STUB_DIR/open-pr-heads"; then echo '[{"number":42}]'; else echo '[]'; fi
`

let stubDir: string

beforeEach(() => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-cleanup-'))
  const bin = path.join(stubDir, 'bin')
  fs.mkdirSync(bin)
  for (const [name, body] of [
    ['curl', CURL_STUB],
    ['git', GIT_STUB],
    ['gh', GH_STUB],
  ] as const) {
    fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 })
  }
})

afterEach(() => {
  fs.rmSync(stubDir, { recursive: true, force: true })
})

function writeGitState(fixture: Pick<Fixture, 'remoteRefs' | 'openPrHeads'>) {
  fs.writeFileSync(path.join(stubDir, 'remote-refs'), (fixture.remoteRefs ?? []).join('\n') + '\n')
  fs.writeFileSync(
    path.join(stubDir, 'open-pr-heads'),
    (fixture.openPrHeads ?? []).join('\n') + '\n',
  )
  fs.writeFileSync(path.join(stubDir, 'calls'), '')
}

function stubEnv(fixture: Pick<Fixture, 'gitFails' | 'ghFails'>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${path.join(stubDir, 'bin')}:${process.env.PATH}`,
    STUB_DIR: stubDir,
    STUB_GIT_FAILS: fixture.gitFails ? '1' : '0',
    STUB_GH_FAILS: fixture.ghFails ? '1' : '0',
  }
}

/**
 * Runs `sweep` against the fixture. `override` is shell sourced after the
 * script and before the sweep, to replace a helper for a failure-mode test.
 */
function sweep(fixture: Fixture, override = '') {
  const branches = fixture.branches.map((b, i) => ({
    id: b.id ?? `br-${i}`,
    updated_at: OLD,
    compute_time_seconds: 0,
    written_data_bytes: 0,
    ...b,
  }))
  fs.writeFileSync(path.join(stubDir, 'branches.json'), JSON.stringify({ branches }))
  writeGitState(fixture)
  const stepSummary = path.join(stubDir, 'step-summary.md')

  const args = override
    ? ['-c', `source "$1"; ${override}; main sweep`, 'bash', neonCleanup]
    : [neonCleanup, 'sweep']
  const r = spawnSync('bash', args, {
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...stubEnv(fixture),
      STUB_LINEAR_STATE: fixture.linearState ?? 'started',
      NEON_API_KEY: 'neon-test',
      NEON_PROJECT_ID: 'proj-test',
      LINEAR_API_KEY: 'lin-test',
      NEON_CLEANUP_DRY_RUN: fixture.dryRun ?? '1',
      NEON_CLEANUP_MIN_AGE_HOURS: fixture.minAgeHours ?? '24',
      NEON_CLEANUP_GIT_REMOTE: '',
      GITHUB_STEP_SUMMARY: stepSummary,
    },
  })
  const calls = fs.readFileSync(path.join(stubDir, 'calls'), 'utf8').split('\n').filter(Boolean)
  const summary = fs.existsSync(stepSummary) ? fs.readFileSync(stepSummary, 'utf8') : ''
  return { status: r.status, err: r.stderr, calls, summary }
}

const ORPHAN = 'preview/kaupo/hon-802-some-slug'
const ORPHAN_REF = 'kaupo/hon-802-some-slug'

describe('neon-cleanup.sh sweep — preview/* path (HON-852)', () => {
  it('lists a preview branch as a candidate when its ref is gone and no open PR has it', () => {
    const r = sweep({ branches: [{ name: ORPHAN }] })

    expect(r.status).toBe(0)
    expect(r.err).toContain(`preview candidate: ${ORPHAN}`)
    expect(r.err).toContain(`DRY-RUN would delete: ${ORPHAN}`)
    // The ref is looked up by its full path on the configured remote, so
    // ls-remote's tail matching cannot answer for a different branch.
    expect(r.calls).toContain(`git ls-remote --exit-code --heads origin refs/heads/${ORPHAN_REF}`)
    expect(
      r.calls.some((c) => c.startsWith('gh pr list') && c.includes(`--head ${ORPHAN_REF}`)),
    ).toBe(true)
    // Dry run: no DELETE reaches Neon.
    expect(r.calls.some((c) => c.startsWith('curl DELETE'))).toBe(false)
  })

  it('does not consult Linear for a preview branch', () => {
    const r = sweep({ branches: [{ name: ORPHAN }] })

    expect(r.calls.some((c) => c.includes('linear'))).toBe(false)
  })

  it('skips a preview branch whose ref still exists on origin', () => {
    const r = sweep({ branches: [{ name: ORPHAN }], remoteRefs: [ORPHAN_REF] })

    expect(r.err).toContain(`skip ${ORPHAN}: preview ref-on-remote`)
    expect(r.err).not.toContain('preview candidate:')
  })

  it.each([
    ['no usage', {}],
    ['compute usage', { compute_time_seconds: 3600 }],
    ['written data', { written_data_bytes: 1_000_000 }],
    ['a fresh branch', { updated_at: young() }],
  ])('never makes a branch whose ref exists a candidate, with %s', (_label, extra) => {
    const r = sweep({
      branches: [{ name: ORPHAN, ...extra }],
      remoteRefs: [ORPHAN_REF],
      minAgeHours: '0',
    })

    expect(r.err).not.toContain('preview candidate:')
    expect(r.err).not.toContain('DRY-RUN would delete')
  })

  it('skips a preview branch whose ref heads an open PR', () => {
    const r = sweep({ branches: [{ name: ORPHAN }], openPrHeads: [ORPHAN_REF] })

    expect(r.err).toContain(`skip ${ORPHAN}: preview open-pr`)
    expect(r.err).not.toContain('preview candidate:')
  })

  it('fails safe when the ref lookup errors', () => {
    const r = sweep({ branches: [{ name: ORPHAN }], gitFails: true })

    expect(r.err).toContain(`skip ${ORPHAN}: preview ref-lookup-failed`)
    expect(r.err).not.toContain('preview candidate:')
  })

  it('fails safe when the open-PR lookup errors', () => {
    const r = sweep({ branches: [{ name: ORPHAN }], ghFails: true })

    expect(r.err).toContain(`skip ${ORPHAN}: preview pr-lookup-failed`)
    expect(r.err).not.toContain('preview candidate:')
  })

  it.each([
    ['default', { default: true }, 'protected'],
    ['primary', { primary: true }, 'protected'],
    ['protected', { protected: true }, 'protected'],
  ])('never makes a %s preview branch a candidate', (_label, extra, reason) => {
    const r = sweep({ branches: [{ name: ORPHAN, ...extra }], minAgeHours: '0' })

    expect(r.err).toContain(`skip ${ORPHAN}: preview ${reason}`)
    expect(r.err).not.toContain('preview candidate:')
    // Refused before any network lookup.
    expect(r.calls.some((c) => c.startsWith('git') || c.startsWith('gh'))).toBe(false)
  })

  it.each(['main', 'staging', 'dev/kaupo', 'vercel-dev'])(
    'never deletes the allowlisted branch %s',
    (name) => {
      const r = sweep({ branches: [{ name }], minAgeHours: '0', linearState: 'completed' })

      expect(r.err).not.toContain('preview candidate:')
      expect(r.err).not.toContain('DRY-RUN would delete')
    },
  )

  it('skips a preview branch younger than the age gate', () => {
    const r = sweep({ branches: [{ name: ORPHAN, updated_at: young() }] })

    expect(r.err).toContain(`skip ${ORPHAN}: preview too-young`)
    expect(r.calls.some((c) => c.startsWith('git') || c.startsWith('gh'))).toBe(false)
  })

  it.each([
    'preview/',
    'preview/has space',
    'preview/a..b',
    'preview/-rf',
    'preview//lead',
    'preview/trail/',
    'preview/a//b',
    'preview/semi;colon',
  ])('refuses the implausible ref in %j without calling git or gh', (name) => {
    const r = sweep({ branches: [{ name }] })

    expect(r.err).toContain(`skip ${name}: preview invalid-ref`)
    expect(r.calls.some((c) => c.startsWith('git') || c.startsWith('gh'))).toBe(false)
  })

  it('keeps a branch whose age cannot be read', () => {
    const r = sweep({ branches: [{ name: ORPHAN, updated_at: 'not-a-date' }] })

    expect(r.status).toBe(0)
    expect(r.err).toContain(`skip ${ORPHAN}: preview `)
    expect(r.err).not.toContain('preview candidate:')
  })

  it('keeps a branch whose gate dies partway rather than reading silence as delete', () => {
    // The gate's verdict is positive (`ok`), so the empty output a crashed
    // helper leaves behind must not delete. Simulated by making the ref check
    // kill the gate's subshell outright.
    const r = sweep({ branches: [{ name: ORPHAN }] }, 'preview_ref_plausible() { exit 3; }')

    expect(r.status).toBe(0)
    expect(r.err).toContain(`skip ${ORPHAN}: preview gate-error`)
    expect(r.err).not.toContain('preview candidate:')
  })

  it('logs the usage of an orphan that has some, and still makes it a candidate', () => {
    const r = sweep({
      branches: [{ name: ORPHAN, compute_time_seconds: 42, written_data_bytes: 7 }],
    })

    expect(r.err).toContain(
      `preview candidate: ${ORPHAN} (usage: compute_time_seconds=42 written_data_bytes=7)`,
    )
    expect(r.err).toMatch(/preview considered=1 candidates=1 would delete=1 with_usage=1/)
  })

  it('deletes only the orphan in live mode', () => {
    const r = sweep({
      dryRun: '0',
      branches: [
        { id: 'br-orphan', name: ORPHAN },
        { id: 'br-live', name: 'preview/kaupo/hon-900-open' },
        { id: 'br-kept', name: 'preview/kaupo/hon-901-on-origin' },
      ],
      openPrHeads: ['kaupo/hon-900-open'],
      remoteRefs: ['kaupo/hon-901-on-origin'],
    })

    const deletes = r.calls.filter((c) => c.startsWith('curl DELETE'))
    expect(deletes).toHaveLength(1)
    expect(deletes[0]).toContain('/projects/proj-test/branches/br-orphan')
    expect(r.err).toContain(`DELETED: ${ORPHAN} (br-orphan)`)
  })

  it('reports the preview counters in the log and the step summary', () => {
    const r = sweep({
      branches: [
        { name: ORPHAN },
        { name: 'preview/kaupo/hon-900-open' },
        { name: 'preview/kaupo/hon-901-on-origin' },
        { name: 'preview/kaupo/hon-902-on-origin' },
      ],
      openPrHeads: ['kaupo/hon-900-open'],
      remoteRefs: ['kaupo/hon-901-on-origin', 'kaupo/hon-902-on-origin'],
    })

    expect(r.err).toContain(
      'neon-cleanup sweep: preview considered=4 candidates=1 would delete=1 with_usage=0 skipped: open-pr=1 ref-on-remote=2',
    )
    expect(r.summary).toContain('- Preview considered: 4')
    expect(r.summary).toContain('- Preview candidates: 1')
    expect(r.summary).toContain('- Preview would delete: 1')
    expect(r.summary).toContain('- Preview skipped: open-pr=1 ref-on-remote=2')
  })

  it('reports no preview skips as none', () => {
    const r = sweep({ branches: [] })

    expect(r.status).toBe(0)
    expect(r.err).toContain(
      'preview considered=0 candidates=0 would delete=0 with_usage=0 skipped: none',
    )
  })
})

describe('neon-cleanup.sh sweep — <prefix>--hon-<N> path is unchanged', () => {
  it('still deletes a Done issue branch and leaves an open one', () => {
    const done = sweep({ branches: [{ name: 'kaupo--hon-51-slug' }], linearState: 'completed' })
    const open = sweep({ branches: [{ name: 'kaupo--hon-51-slug' }], linearState: 'started' })

    expect(done.err).toContain('DRY-RUN would delete: kaupo--hon-51-slug')
    expect(open.err).toContain('skip kaupo--hon-51-slug: HON-51 not Done/Canceled')
    // The HON path never asks git or GitHub.
    expect(done.calls.some((c) => c.startsWith('git') || c.startsWith('gh'))).toBe(false)
  })

  it('still applies the age gate to a Done issue branch', () => {
    const r = sweep({
      branches: [{ name: 'kaupo--hon-51-slug', updated_at: young() }],
      linearState: 'completed',
    })

    expect(r.err).toContain('skip kaupo--hon-51-slug: younger than 24h')
    expect(r.err).not.toContain('DRY-RUN would delete')
  })
})

/**
 * The local cap-time GC in worktree-claude.sh (`neon_gc_orphans`) applies the
 * same ref + open-PR rule through `neon_gc_preview_orphan_names`. Sourced, not
 * executed: the script returns before its dispatcher and .env load.
 */
describe('worktree-claude.sh neon_gc_preview_orphan_names (HON-852)', () => {
  function localSelect(fixture: Omit<Fixture, 'branches'> & { branches: Branch[] }): string[] {
    writeGitState(fixture)
    const r = spawnSync(
      'bash',
      [
        '-c',
        'source "$1"; neon_gc_preview_orphan_names "$2"',
        'bash',
        worktreeClaude,
        JSON.stringify(fixture.branches),
      ],
      { encoding: 'utf8', timeout: 30_000, env: stubEnv(fixture) },
    )
    expect(r.status, r.stderr).toBe(0)
    return r.stdout.split('\n').filter(Boolean)
  }

  const BRANCHES: Branch[] = [
    { name: ORPHAN },
    { name: 'preview/kaupo/hon-900-open' },
    { name: 'preview/kaupo/hon-901-on-origin' },
    { name: 'preview/kaupo/hon-903-protected', protected: true },
    { name: 'preview/kaupo/hon-904-default', default: true },
    { name: 'preview/-rf' },
    { name: 'preview/a..b' },
    { name: 'preview' },
    { name: 'kaupo--hon-51-slug' },
    { name: 'main' },
  ]

  it('selects only the orphaned preview branch', () => {
    const selected = localSelect({
      branches: BRANCHES,
      openPrHeads: ['kaupo/hon-900-open'],
      remoteRefs: ['kaupo/hon-901-on-origin'],
    })

    expect(selected).toEqual([ORPHAN])
  })

  it('accepts the `{ branches: [...] }` wire format as well', () => {
    writeGitState({})
    const r = spawnSync(
      'bash',
      [
        '-c',
        'source "$1"; neon_gc_preview_orphan_names "$2"',
        'bash',
        worktreeClaude,
        JSON.stringify({ branches: [{ name: ORPHAN }] }),
      ],
      { encoding: 'utf8', timeout: 30_000, env: stubEnv({}) },
    )

    expect(r.stdout.trim()).toBe(ORPHAN)
  })

  it('keeps every preview branch when the ref lookup fails', () => {
    expect(localSelect({ branches: BRANCHES, gitFails: true })).toEqual([])
  })

  it('keeps every preview branch when the open-PR lookup fails', () => {
    expect(localSelect({ branches: BRANCHES, ghFails: true })).toEqual([])
  })

  it('agrees with neon-cleanup.sh on the ref charset', () => {
    const read = (script: string) =>
      spawnSync('bash', ['-c', 'source "$1"; printf %s "$PREVIEW_REF_REGEX"', 'bash', script], {
        encoding: 'utf8',
        timeout: 30_000,
      }).stdout

    expect(read(worktreeClaude)).toBe(read(neonCleanup))
    expect(read(neonCleanup)).not.toBe('')
  })
})
