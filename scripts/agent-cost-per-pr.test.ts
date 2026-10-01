import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  assertUnderLimit,
  buildReport,
  costTotal,
  dedupeRequests,
  isoInstant,
  monthWindows,
  parseTranscript,
  PRICING,
  PRICING_READ_ON,
  priceUsage,
  prWindowStart,
  quantile,
  readTranscripts,
  toCsv,
  type MergedPr,
  type Usage,
} from './agent-cost-per-pr'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptsDir, '..')
const script = path.join(scriptsDir, 'agent-cost-per-pr.ts')
const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx')

// ============================================
// FIXTURE
// ============================================

type LineOptions = {
  requestId: string
  sessionId: string
  gitBranch: string
  timestamp: string
  model?: string
  usage?: Usage
  skill?: string
  entrypoint?: string
  isSidechain?: boolean
  stopReason?: string
}

/** Defaults to 40,000 opus-5 output tokens, which is exactly $1, so every expected cost below is a request count. */
function assistantLine(options: LineOptions): string {
  return JSON.stringify({
    type: 'assistant',
    requestId: options.requestId,
    sessionId: options.sessionId,
    gitBranch: options.gitBranch,
    timestamp: options.timestamp,
    attributionSkill: options.skill,
    entrypoint: options.entrypoint ?? 'cli',
    isSidechain: options.isSidechain ?? false,
    message: {
      model: options.model ?? 'claude-opus-5',
      stop_reason: options.stopReason ?? 'tool_use',
      usage: options.usage ?? { input_tokens: 0, output_tokens: 40_000 },
    },
  })
}

function prLink(sessionId: string, prNumber: number, timestamp: string): string {
  return JSON.stringify({
    type: 'pr-link',
    sessionId,
    prNumber,
    prUrl: `https://github.com/kaupok/wobblepot/pull/${prNumber}`,
    prRepository: 'kaupok/wobblepot',
    timestamp,
  })
}

const PRS: MergedPr[] = [
  {
    number: 10,
    headRefName: 'kaupo/hon-1-feature',
    mergedAt: '2026-09-10T12:00:00Z',
    additions: 90,
    deletions: 10,
  },
  // Two merged PRs off one reused branch, as hon-533 has.
  {
    number: 20,
    headRefName: 'kaupo/hon-2-reused',
    mergedAt: '2026-09-11T12:00:00Z',
    additions: 5,
    deletions: 5,
  },
  {
    number: 21,
    headRefName: 'kaupo/hon-2-reused',
    mergedAt: '2026-09-12T12:00:00Z',
    additions: 5,
    deletions: 5,
  },
  {
    number: 30,
    headRefName: 'fix/main-session-work',
    mergedAt: '2026-09-13T12:00:00Z',
    additions: 1,
    deletions: 0,
  },
  {
    number: 40,
    headRefName: 'docs/url-only',
    mergedAt: '2026-10-02T12:00:00Z',
    additions: 2,
    deletions: 0,
  },
  // A historical `auto/hon-NNN` head: a merged PR wins over the overhead rule.
  {
    number: 50,
    headRefName: 'auto/hon-5',
    mergedAt: '2026-10-03T12:00:00Z',
    additions: 1,
    deletions: 1,
  },
]

/** Writes a `~/.claude/projects`-shaped tree. Returns its root. */
function writeFixture(root: string, extraLines: string[] = []): string {
  const worktree = path.join(root, '-Users-kaupo--worktrees-wobblepot-kaupo--hon-1-feature')
  const main = path.join(root, '-Users-kaupo-Projects-wobblepot')
  const unrelated = path.join(root, '-Users-kaupo-Projects-other')
  fs.mkdirSync(path.join(worktree, 'sess-wt', 'subagents'), { recursive: true })
  fs.mkdirSync(main, { recursive: true })
  fs.mkdirSync(unrelated, { recursive: true })

  fs.writeFileSync(
    path.join(worktree, 'sess-wt.jsonl'),
    [
      // Same request on two lines: the first carries a partial output count.
      assistantLine({
        requestId: 'r1',
        sessionId: 'sess-wt',
        gitBranch: 'kaupo/hon-1-feature',
        timestamp: '2026-09-10T10:00:00Z',
        usage: { output_tokens: 3 },
      }),
      assistantLine({
        requestId: 'r1',
        sessionId: 'sess-wt',
        gitBranch: 'kaupo/hon-1-feature',
        timestamp: '2026-09-10T10:00:01Z',
        skill: 'auto-implement',
        stopReason: 'end_turn',
      }),
      assistantLine({
        requestId: 'r2',
        sessionId: 'sess-wt',
        gitBranch: 'kaupo/hon-2-reused',
        timestamp: '2026-09-11T10:00:00Z',
      }),
      assistantLine({
        requestId: 'r3',
        sessionId: 'sess-wt',
        gitBranch: 'kaupo/hon-2-reused',
        timestamp: '2026-09-12T10:00:00Z',
      }),
      assistantLine({
        requestId: 'r4',
        sessionId: 'sess-wt',
        gitBranch: 'kaupo/hon-2-reused',
        timestamp: '2026-09-20T10:00:00Z',
      }),
      assistantLine({
        requestId: 'r5',
        sessionId: 'sess-wt',
        gitBranch: 'auto/20260915-101500',
        timestamp: '2026-09-15T10:00:00Z',
      }),
      assistantLine({
        requestId: 'r6',
        sessionId: 'sess-wt',
        gitBranch: 'auto/hon-5',
        timestamp: '2026-10-03T10:00:00Z',
      }),
      assistantLine({
        requestId: 'r7',
        sessionId: 'sess-wt',
        gitBranch: 'kaupo/hon-9-never-merged',
        timestamp: '2026-09-15T10:00:00Z',
      }),
      // A local placeholder message: zero usage, never sent to the API.
      JSON.stringify({
        type: 'assistant',
        sessionId: 'sess-wt',
        timestamp: '2026-09-10T10:00:02Z',
        message: { model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } },
      }),
      '{"type":"assistant","truncated',
    ].join('\n'),
  )
  fs.writeFileSync(
    path.join(worktree, 'sess-wt', 'subagents', 'agent-a1.jsonl'),
    assistantLine({
      requestId: 'r8',
      sessionId: 'sess-wt',
      gitBranch: 'kaupo/hon-1-feature',
      timestamp: '2026-09-10T10:05:00Z',
      isSidechain: true,
      skill: 'auto-implement',
      stopReason: 'end_turn',
    }),
  )

  fs.writeFileSync(
    path.join(main, 'sess-main.jsonl'),
    [
      assistantLine({
        requestId: 'm1',
        sessionId: 'sess-main',
        gitBranch: 'main',
        timestamp: '2026-09-13T09:00:00Z',
        entrypoint: 'sdk-cli',
      }),
      // The URL mention is ignored: this session has a pr-link, which wins.
      JSON.stringify({
        type: 'user',
        sessionId: 'sess-main',
        timestamp: '2026-09-13T09:30:00Z',
        message: { content: 'see https://github.com/kaupok/wobblepot/pull/40' },
      }),
      prLink('sess-main', 30, '2026-09-13T10:00:00Z'),
      assistantLine({
        requestId: 'm2',
        sessionId: 'sess-main',
        gitBranch: 'main',
        timestamp: '2026-09-13T11:00:00Z',
      }),
      assistantLine({
        requestId: 'u1',
        sessionId: 'sess-url',
        gitBranch: 'main',
        timestamp: '2026-10-02T09:00:00Z',
      }),
      JSON.stringify({
        type: 'user',
        sessionId: 'sess-url',
        timestamp: '2026-10-02T09:01:00Z',
        message: { content: 'opened https://github.com/kaupok/wobblepot/pull/40' },
      }),
      assistantLine({
        requestId: 'n1',
        sessionId: 'sess-none',
        gitBranch: 'main',
        timestamp: '2026-10-02T09:00:00Z',
      }),
      ...extraLines,
    ].join('\n'),
  )

  // Outside the walk: a slug without `wobblepot`.
  fs.writeFileSync(
    path.join(unrelated, 'sess-other.jsonl'),
    assistantLine({
      requestId: 'x1',
      sessionId: 'sess-other',
      gitBranch: 'kaupo/hon-1-feature',
      timestamp: '2026-09-10T10:00:00Z',
    }),
  )
  return root
}

let tmpDir: string
let fixtureRoot: string

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-cost-'))
  fixtureRoot = writeFixture(path.join(tmpDir, 'projects'))
})

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ============================================
// PRICING
// ============================================

describe('priceUsage', () => {
  it("reproduces Claude Code's own cost-state figure for claude-opus-5", () => {
    // From a real `cost-state` record: Claude Code reported $7.02246 for this usage.
    const cost = priceUsage('claude-opus-5', {
      input_tokens: 100,
      output_tokens: 41_313,
      cache_read_input_tokens: 8_083_890,
      cache_creation_input_tokens: 194_719,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 194_719 },
    })
    expect(costTotal(cost)).toBeCloseTo(7.02246, 5)
    expect(cost.cacheWrite1h).toBeCloseTo(1.94719, 5)
  })

  it('prices a cache write with no 5m/1h split at the 5m rate', () => {
    const cost = priceUsage('claude-opus-5-5', { cache_creation_input_tokens: 1_000_000 })
    expect(cost.cacheWrite5m).toBe(PRICING['claude-opus-5-5']!.cacheWrite5m)
    expect(cost.cacheWrite1h).toBe(0)
  })

  it('applies the 1.1x multiplier for US-only inference', () => {
    const cost = priceUsage('claude-opus-5', { output_tokens: 1_000_000, inference_geo: 'us' })
    expect(cost.output).toBeCloseTo(27.5, 6)
  })

  it('throws on a model with no price rather than pricing it at zero', () => {
    expect(() => priceUsage('claude-unknown-9', { output_tokens: 1 })).toThrow(
      /No price for model "claude-unknown-9"/,
    )
  })

  it('throws on fast mode, which has its own rates', () => {
    expect(() => priceUsage('claude-opus-5', { output_tokens: 1, speed: 'fast' })).toThrow(
      /speed "fast"/,
    )
  })

  it('records the date the prices were read', () => {
    expect(PRICING_READ_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

// ============================================
// TRANSCRIPTS
// ============================================

describe('transcripts', () => {
  it('walks wobblepot project dirs only, subagent transcripts included', () => {
    const { requests } = readTranscripts(fixtureRoot)
    const ids = new Set(requests.map((request) => request.requestId))
    expect(ids.has('r8')).toBe(true)
    expect(ids.has('x1')).toBe(false)
    expect(requests.find((request) => request.requestId === 'r8')?.isSubagent).toBe(true)
  })

  it('dedupes by requestId, keeping the last line and its final output count', () => {
    const { requests } = readTranscripts(fixtureRoot)
    expect(requests.filter((request) => request.requestId === 'r1')).toHaveLength(2)
    const r1 = dedupeRequests(requests).filter((request) => request.requestId === 'r1')
    expect(r1).toHaveLength(1)
    expect(r1[0]!.usage.output_tokens).toBe(40_000)
  })

  it('skips <synthetic> messages but throws if one ever carries usage', () => {
    const line = JSON.stringify({
      type: 'assistant',
      sessionId: 's',
      message: { model: '<synthetic>', usage: { output_tokens: 5 } },
    })
    expect(() => parseTranscript(line, 'x.jsonl')).toThrow(/<synthetic>/)
  })

  it('labels a skill-less sdk-cli request as headless', () => {
    const { requests } = readTranscripts(fixtureRoot)
    expect(requests.find((request) => request.requestId === 'm1')?.skill).toBe('(headless)')
  })
})

// ============================================
// ATTRIBUTION AND REPORT
// ============================================

describe('buildReport', () => {
  const report = () => buildReport(readTranscripts(fixtureRoot), PRS)
  const row = (pr: number) => report().rows.find((candidate) => candidate.pr === pr)

  it('joins a worktree branch to its merged PR, with the subagent share', () => {
    const pr10 = row(10)!
    expect(pr10.requests).toBe(2)
    expect(pr10.total).toBeCloseTo(2, 6)
    expect(pr10.subagentCost / pr10.total).toBeCloseTo(0.5, 6)
    expect(pr10.turns).toBe(1)
    expect(pr10.changedLines).toBe(100)
    expect(pr10.bySkill.get('auto-implement')).toBeCloseTo(2, 6)
  })

  it('splits a reused branch by merge time, giving post-merge work to the latest PR', () => {
    expect(row(20)!.requests).toBe(1)
    expect(row(21)!.requests).toBe(2)
  })

  it('prefers a merged PR over the auto/ overhead rule', () => {
    expect(row(50)!.requests).toBe(1)
  })

  it('reports an auto/ branch with no merged PR as orchestrator overhead', () => {
    expect(report().overhead).toBeCloseTo(1, 6)
  })

  it('attributes main-branch work to the pr-link it leads to, and follow-up to the last one', () => {
    expect(row(30)!.requests).toBe(2)
  })

  it('falls back to a pull URL mention when the session has no pr-link', () => {
    expect(row(40)!.requests).toBe(1)
  })

  it('reports what it cannot attribute, by reason', () => {
    const { unattributed, total } = report()
    expect(unattributed.get('main: session names no merged PR')).toBeCloseTo(1, 6)
    expect(unattributed.get('branch has no merged PR')).toBeCloseTo(1, 6)
    expect(total).toBeCloseTo(12, 6)
  })

  it('throws on an unknown model anywhere in the walk', () => {
    const root = writeFixture(path.join(tmpDir, 'unknown-model'), [
      assistantLine({
        requestId: 'z1',
        sessionId: 'sess-z',
        gitBranch: 'main',
        timestamp: '2026-09-01T00:00:00Z',
        model: 'claude-unknown-9',
      }),
    ])
    expect(() => buildReport(readTranscripts(root), PRS)).toThrow(/claude-unknown-9/)
  })

  it('writes one CSV row per PR', () => {
    const csv = toCsv(report().rows).trim().split('\n')
    expect(csv[0]).toMatch(/^pr,merged_at,first_request_at,total_usd,/)
    expect(csv).toHaveLength(1 + 6)
  })
})

describe('isoInstant', () => {
  it('normalises gh and transcript timestamps so they compare correctly as text', () => {
    const merged = isoInstant('2026-09-10T12:00:00Z')
    const later = isoInstant('2026-09-10T12:00:00.500Z')
    expect(merged).toBe('2026-09-10T12:00:00.000Z')
    expect(later > merged).toBe(true)
  })

  it('throws on a timestamp it cannot parse', () => {
    expect(() => isoInstant('yesterday')).toThrow(/Unparseable timestamp/)
  })
})

describe('merged-PR fetch', () => {
  it('opens the PR window 30 days before the oldest request', () => {
    expect(prWindowStart(readTranscripts(fixtureRoot).requests)).toBe('2026-08-11')
  })

  it('splits the window into calendar months, so no single search nears the cap', () => {
    expect(monthWindows('2026-08-11', '2026-10-01')).toEqual([
      ['2026-08-11', '2026-08-31'],
      ['2026-09-01', '2026-09-30'],
      ['2026-10-01', '2026-10-01'],
    ])
    expect(monthWindows('2026-12-15', '2027-01-03')).toEqual([
      ['2026-12-15', '2026-12-31'],
      ['2027-01-01', '2027-01-03'],
    ])
    expect(monthWindows('2026-10-02', '2026-10-01')).toEqual([])
  })

  it('throws when gh fills its --limit, since the missing PRs would move cost elsewhere', () => {
    expect(() => assertUnderLimit(PRS, PRS.length)).toThrow(/the search cap/)
    expect(assertUnderLimit(PRS, PRS.length + 1)).toBe(PRS)
  })
})

describe('quantile', () => {
  it('interpolates between ranks', () => {
    expect(quantile([4, 1, 3, 2], 0.5)).toBe(2.5)
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1, 6)
    expect(quantile([], 0.5)).toBe(0)
  })
})

// ============================================
// CLI
// ============================================

function run(...args: string[]): { status: number; output: string } {
  const result = spawnSync(tsx, [script, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    cwd: repoRoot,
  })
  // A missing tsx or a timeout leaves `status` null, which would pass the
  // non-zero assertion below for the wrong reason.
  expect(result.error, `could not spawn ${tsx}`).toBeUndefined()
  expect(result.status, 'process did not exit normally').not.toBeNull()
  return { status: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

describe('pnpm agent-cost', () => {
  it('prints the table and aggregates and writes the CSV', () => {
    const prsFile = path.join(tmpDir, 'prs.json')
    const out = path.join(tmpDir, 'out.csv')
    fs.writeFileSync(prsFile, JSON.stringify(PRS))
    const { status, output } = run(
      '--projects-dir',
      fixtureRoot,
      '--prs',
      prsFile,
      '--out',
      out,
      '--split',
      '2026-10-01T00:00:00Z',
    )
    expect(status).toBe(0)
    expect(output).toContain('#10')
    expect(output).toMatch(/orchestrator overhead \(auto\/\)/)
    expect(output).toMatch(/before 2026-10-01T00:00:00\.000Z\s+4/)
    expect(fs.readFileSync(out, 'utf8')).toMatch(/^pr,merged_at/)
  })

  it('exits non-zero naming an unpriced model', () => {
    const root = writeFixture(path.join(tmpDir, 'cli-unknown'), [
      assistantLine({
        requestId: 'z1',
        sessionId: 'sess-z',
        gitBranch: 'main',
        timestamp: '2026-09-01T00:00:00Z',
        model: 'claude-unknown-9',
      }),
    ])
    const prsFile = path.join(tmpDir, 'prs-unknown.json')
    fs.writeFileSync(prsFile, JSON.stringify(PRS))
    const { status, output } = run(
      '--projects-dir',
      root,
      '--prs',
      prsFile,
      '--out',
      path.join(tmpDir, 'x.csv'),
    )
    expect(status).toBe(1)
    expect(output).toMatch(/No price for model "claude-unknown-9"/)
  })
})
