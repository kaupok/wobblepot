/**
 * Agent token cost per merged PR (HON-785)
 *
 * Every harness change we might make (CLAUDE.md size, the auto-implement skill,
 * the worker model mix) needs a baseline to be judged against, and it has to be
 * measured per task rather than per request: a change that shrinks each request
 * but adds turns can cost more. This script produces that number from the
 * Claude Code transcripts on disk.
 *
 * All runs are local, so `~/.claude/projects/<cwd-slug>/**.jsonl` holds every
 * request, including subagent transcripts under `<sessionId>/subagents/`.
 * Sessions run on the Max subscription, so the output is a quota proxy priced at
 * API list rates, not dollars billed. Weighting by billing type is still the
 * point: output, uncached input and cached input consume quota very differently.
 *
 * How a request is counted:
 *   1. Dedupe by `requestId`, keeping the last line. Claude Code writes one line
 *      per content block, and the earlier ones can carry a partial
 *      `output_tokens` (3 where the final line has 980), so summing every line
 *      roughly doubles the total and keeping the first undercounts output.
 *   2. Join `gitBranch` to a merged PR's `headRefName`. A branch reused by
 *      several merged PRs goes to the first one merged at or after the request.
 *   3. On `main`, `HEAD` or no branch, fall back to the PRs the session itself
 *      names: its `pr-link` records, or failing those any
 *      `github.com/kaupok/wobblepot/pull/<n>` mention.
 *   4. An `auto/` branch with no merged PR is orchestrator overhead, reported on
 *      its own row. Anything else is unattributed and reported with its reason.
 *
 * Transcripts are pruned after `cleanupPeriodDays` (see docs/PARALLEL_WORKFLOW.md
 * → Configuration), so the history this can see is only as long as that setting.
 *
 * Usage: pnpm agent-cost [--out <file.csv>] [--since YYYY-MM-DD] [--split <ISO>]
 *                        [--projects-dir <dir>] [--prs <file.json>]
 *   --out           CSV destination (default: $TMPDIR/agent-cost-per-pr-<date>.csv)
 *   --since         only report PRs merged on or after this date
 *   --split         also print aggregates for PRs whose first request is
 *                   before vs at/after this instant (a harness change landing)
 *   --projects-dir  transcript root (default: ~/.claude/projects)
 *   --prs           read the merged-PR list from a JSON file instead of `gh`
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// ============================================
// PRICING
// ============================================

/**
 * USD per million tokens, read from the source below on the date below — not
 * from memory. Re-read the page when adding a row or when a price changes.
 *
 * Rows are the models the transcript walk found on 2026-10-01, plus
 * `claude-fable-5` and `claude-opus-4-8`, which the 2026-09-24 walk saw. A model
 * with no row throws: pricing it at zero would quietly shrink the baseline.
 */
export const PRICING_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing'
export const PRICING_READ_ON = '2026-10-01'

export type Price = {
  input: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
  output: number
}

export const PRICING: Record<string, Price> = {
  'claude-fable-5-1': {
    input: 10,
    cacheWrite5m: 12.5,
    cacheWrite1h: 20,
    cacheRead: 0.25,
    output: 50,
  },
  'claude-fable-5': { input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 1, output: 50 },
  'claude-opus-5-5': { input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 },
  'claude-opus-5': { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  'claude-opus-4-8': { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  'claude-sonnet-5': { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2, output: 10 },
  'claude-haiku-4-5-20251001': {
    input: 1,
    cacheWrite5m: 1.25,
    cacheWrite1h: 2,
    cacheRead: 0.1,
    output: 5,
  },
}

/** The pricing page's multiplier for `inference_geo: "us"` on 4.6-and-later models. */
const US_INFERENCE_MULTIPLIER = 1.1

/**
 * Claude Code's model id for messages it writes locally (interrupts, errors).
 * They never reach the API, so they are skipped — but only while their usage
 * is zero, so a future change to that cannot hide real tokens.
 */
const SYNTHETIC_MODEL = '<synthetic>'

export const BILLING_TYPES = [
  'input',
  'cacheWrite5m',
  'cacheWrite1h',
  'cacheRead',
  'output',
] as const
export type BillingType = (typeof BILLING_TYPES)[number]
export type Cost = Record<BillingType, number>

export type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | null
  speed?: string | null
  inference_geo?: string | null
}

export function emptyCost(): Cost {
  return { input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 }
}

export function costTotal(cost: Cost): number {
  return BILLING_TYPES.reduce((sum, type) => sum + cost[type], 0)
}

function addCost(into: Cost, from: Cost): void {
  for (const type of BILLING_TYPES) into[type] += from[type]
}

/** Tokens per billing type. A write with no 5m/1h split is priced as 5m, the API default TTL. */
export function tokensByBillingType(usage: Usage): Cost {
  const written = usage.cache_creation_input_tokens ?? 0
  const split = usage.cache_creation
  const write1h = split ? (split.ephemeral_1h_input_tokens ?? 0) : 0
  const write5m = split ? (split.ephemeral_5m_input_tokens ?? 0) : written
  return {
    input: usage.input_tokens ?? 0,
    cacheWrite5m: write5m,
    cacheWrite1h: write1h,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
  }
}

/** USD per billing type for one request. Throws on any model or mode without a price. */
export function priceUsage(model: string, usage: Usage): Cost {
  const price = PRICING[model]
  if (!price) {
    throw new Error(
      `No price for model "${model}". Add a row to PRICING from ${PRICING_SOURCE} and update PRICING_READ_ON.`,
    )
  }
  if (usage.speed && usage.speed !== 'standard') {
    throw new Error(
      `No price for speed "${usage.speed}" on ${model}. Fast mode has its own rates on ${PRICING_SOURCE}.`,
    )
  }
  const multiplier = usage.inference_geo === 'us' ? US_INFERENCE_MULTIPLIER : 1
  const tokens = tokensByBillingType(usage)
  const cost = emptyCost()
  for (const type of BILLING_TYPES) cost[type] = (tokens[type] * price[type] * multiplier) / 1e6
  return cost
}

// ============================================
// TRANSCRIPTS
// ============================================

export type RequestRecord = {
  requestId: string
  model: string
  usage: Usage
  sessionId: string
  gitBranch: string
  timestamp: string
  skill: string
  isSubagent: boolean
  endsTurn: boolean
}

/** A PR a session names: a `pr-link` record, or a pull URL anywhere on a line. */
export type Anchor = { sessionId: string; pr: number; timestamp: string; source: 'pr-link' | 'url' }

export type Transcripts = { requests: RequestRecord[]; anchors: Anchor[] }

const REPO = 'kaupok/wobblepot'
const PULL_URL = /github\.com\/kaupok\/wobblepot\/pull\/(\d+)/g

type TranscriptLine = {
  type?: string
  requestId?: string
  sessionId?: string
  gitBranch?: string
  timestamp?: string
  attributionSkill?: string
  entrypoint?: string
  isSidechain?: boolean
  prNumber?: number
  prRepository?: string
  message?: { model?: string; usage?: Usage; stop_reason?: string | null }
}

/**
 * Every timestamp is compared as a string, so all of them go through here
 * first. Transcripts carry milliseconds and `gh` does not, and `…12:00:00.5Z`
 * sorts before `…12:00:00Z` as text.
 */
export function isoInstant(value: string | undefined): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error(`Unparseable timestamp "${value}"`)
  return parsed.toISOString()
}

/** Parse one transcript's lines. `file` is only used in error messages. */
export function parseTranscript(text: string, file: string): Transcripts {
  const requests: RequestRecord[] = []
  const anchors: Anchor[] = []
  const isSubagentFile = file.split(path.sep).includes('subagents')

  for (const raw of text.split('\n')) {
    const isAssistant = raw.includes('"type":"assistant"')
    const isPrLink = raw.includes('"type":"pr-link"')
    const mentionsPull = raw.includes('wobblepot/pull/')
    if (!isAssistant && !isPrLink && !mentionsPull) continue

    let line: TranscriptLine
    try {
      line = JSON.parse(raw) as TranscriptLine
    } catch {
      // A session killed mid-write leaves a truncated last line; it has no usage to lose.
      continue
    }
    const sessionId = line.sessionId ?? ''
    const timestamp = isoInstant(line.timestamp)

    if (line.type === 'pr-link') {
      if (line.prRepository === REPO && line.prNumber !== undefined && timestamp) {
        anchors.push({ sessionId, pr: line.prNumber, timestamp, source: 'pr-link' })
      }
      continue
    }

    if (mentionsPull && timestamp) {
      for (const match of raw.matchAll(PULL_URL)) {
        anchors.push({ sessionId, pr: Number(match[1]), timestamp, source: 'url' })
      }
    }

    if (line.type !== 'assistant' || !line.message?.usage) continue
    const model = line.message.model ?? ''
    if (model === SYNTHETIC_MODEL) {
      if (costTotal(tokensByBillingType(line.message.usage)) > 0) {
        throw new Error(`${file}: a ${SYNTHETIC_MODEL} message carries non-zero usage`)
      }
      continue
    }
    if (!line.requestId) throw new Error(`${file}: assistant line for ${model} has no requestId`)

    requests.push({
      requestId: line.requestId,
      model,
      usage: line.message.usage,
      sessionId,
      gitBranch: line.gitBranch ?? '',
      timestamp,
      skill: line.attributionSkill ?? (line.entrypoint === 'sdk-cli' ? '(headless)' : '(none)'),
      isSubagent: isSubagentFile || line.isSidechain === true,
      endsTurn: line.message.stop_reason === 'end_turn',
    })
  }
  return { requests, anchors }
}

function listJsonl(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return listJsonl(full)
    return entry.name.endsWith('.jsonl') ? [full] : []
  })
}

/** Every transcript, subagent ones included, under project dirs whose slug contains `wobblepot`. */
export function readTranscripts(projectsDir: string): Transcripts {
  const requests: RequestRecord[] = []
  const anchors: Anchor[] = []
  const projects = readdirSync(projectsDir, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && entry.name.includes('wobblepot'),
  )
  for (const project of projects) {
    for (const file of listJsonl(path.join(projectsDir, project.name))) {
      const parsed = parseTranscript(readFileSync(file, 'utf8'), file)
      requests.push(...parsed.requests)
      anchors.push(...parsed.anchors)
    }
  }
  return { requests, anchors }
}

/** One record per `requestId`, the last line seen winning (it carries the final output count). */
export function dedupeRequests(requests: RequestRecord[]): RequestRecord[] {
  const byId = new Map<string, RequestRecord>()
  for (const request of requests) byId.set(request.requestId, request)
  return [...byId.values()]
}

// ============================================
// ATTRIBUTION
// ============================================

export type MergedPr = {
  number: number
  headRefName: string
  mergedAt: string
  additions: number
  deletions: number
}

export type Bucket =
  { kind: 'pr'; pr: number } | { kind: 'overhead' } | { kind: 'unattributed'; reason: string }

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

const FALLBACK_BRANCHES = new Set(['main', 'HEAD', ''])

export type Attributor = (request: RequestRecord) => Bucket

export function createAttributor(prs: MergedPr[], anchors: Anchor[]): Attributor {
  const merged = new Set(prs.map((pr) => pr.number))

  const prsByBranch = new Map<string, MergedPr[]>()
  for (const pr of prs) pushTo(prsByBranch, pr.headRefName, pr)
  for (const list of prsByBranch.values()) list.sort((a, b) => a.mergedAt.localeCompare(b.mergedAt))

  // A session's `pr-link` records are Claude Code's own record of the PRs it
  // opened or linked, so they win; URL mentions also come from tool output
  // (a Linear issue's attachments, say) and are only the fallback.
  const anchorsBySession = new Map<string, Anchor[]>()
  for (const source of ['pr-link', 'url'] as const) {
    for (const anchor of anchors) {
      if (anchor.source !== source || !merged.has(anchor.pr)) continue
      if (anchorsBySession.get(anchor.sessionId)?.[0]?.source === 'pr-link' && source === 'url')
        continue
      pushTo(anchorsBySession, anchor.sessionId, anchor)
    }
  }
  for (const list of anchorsBySession.values())
    list.sort((a, b) => a.timestamp.localeCompare(b.timestamp))

  return (request) => {
    const onBranch = prsByBranch.get(request.gitBranch)
    if (onBranch) {
      const pr =
        onBranch.find((candidate) => candidate.mergedAt >= request.timestamp) ?? onBranch.at(-1)
      return { kind: 'pr', pr: pr!.number }
    }
    if (FALLBACK_BRANCHES.has(request.gitBranch)) {
      // Work precedes the PR link it produces, so the next anchor owns a
      // request; anything after the last one (a merge, a Linear summary) is
      // follow-up on the last PR the session touched.
      const sessionAnchors = anchorsBySession.get(request.sessionId)
      if (!sessionAnchors)
        return { kind: 'unattributed', reason: 'main: session names no merged PR' }
      const anchor =
        sessionAnchors.find((candidate) => candidate.timestamp >= request.timestamp) ??
        sessionAnchors.at(-1)
      return { kind: 'pr', pr: anchor!.pr }
    }
    if (request.gitBranch.startsWith('auto/')) return { kind: 'overhead' }
    return { kind: 'unattributed', reason: 'branch has no merged PR' }
  }
}

// ============================================
// REPORT
// ============================================

export type PrRow = {
  pr: number
  mergedAt: string
  firstRequestAt: string
  cost: Cost
  total: number
  byModel: Map<string, number>
  bySkill: Map<string, number>
  turns: number
  requests: number
  subagentCost: number
  changedLines: number
}

export type Report = {
  rows: PrRow[]
  total: number
  overhead: number
  unattributed: Map<string, number>
  byBillingType: Cost
  bySkill: Map<string, number>
  byModel: Map<string, number>
}

function addTo(map: Map<string, number>, key: string, value: number): void {
  map.set(key, (map.get(key) ?? 0) + value)
}

export function buildReport(transcripts: Transcripts, mergedPrs: MergedPr[]): Report {
  const prs = mergedPrs.map((pr) => ({ ...pr, mergedAt: isoInstant(pr.mergedAt) }))
  const attribute = createAttributor(prs, transcripts.anchors)
  const prByNumber = new Map(prs.map((pr) => [pr.number, pr]))
  const rows = new Map<number, PrRow>()
  const report: Report = {
    rows: [],
    total: 0,
    overhead: 0,
    unattributed: new Map(),
    byBillingType: emptyCost(),
    bySkill: new Map(),
    byModel: new Map(),
  }

  for (const request of dedupeRequests(transcripts.requests)) {
    const cost = priceUsage(request.model, request.usage)
    const total = costTotal(cost)
    report.total += total
    addCost(report.byBillingType, cost)
    addTo(report.bySkill, request.skill, total)
    addTo(report.byModel, request.model, total)

    const bucket = attribute(request)
    if (bucket.kind === 'overhead') {
      report.overhead += total
      continue
    }
    if (bucket.kind === 'unattributed') {
      addTo(report.unattributed, bucket.reason, total)
      continue
    }

    const pr = prByNumber.get(bucket.pr)!
    let row = rows.get(pr.number)
    if (!row) {
      row = {
        pr: pr.number,
        mergedAt: pr.mergedAt,
        firstRequestAt: request.timestamp,
        cost: emptyCost(),
        total: 0,
        byModel: new Map(),
        bySkill: new Map(),
        turns: 0,
        requests: 0,
        subagentCost: 0,
        changedLines: pr.additions + pr.deletions,
      }
      rows.set(pr.number, row)
    }
    addCost(row.cost, cost)
    row.total += total
    addTo(row.byModel, request.model, total)
    addTo(row.bySkill, request.skill, total)
    row.requests += 1
    if (request.endsTurn && !request.isSubagent) row.turns += 1
    if (request.isSubagent) row.subagentCost += total
    if (request.timestamp < row.firstRequestAt) row.firstRequestAt = request.timestamp
  }

  report.rows = [...rows.values()].sort((a, b) => a.mergedAt.localeCompare(b.mergedAt))
  return report
}

/** Linear-interpolated quantile of an unsorted list; `q` in [0, 1]. */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * q
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower)
}

export type Aggregate = { label: string; prs: number; median: number; p90: number; total: number }

export function aggregate(label: string, rows: PrRow[]): Aggregate {
  const totals = rows.map((row) => row.total)
  return {
    label,
    prs: rows.length,
    median: quantile(totals, 0.5),
    p90: quantile(totals, 0.9),
    total: totals.reduce((sum, value) => sum + value, 0),
  }
}

export function monthlyAggregates(rows: PrRow[]): Aggregate[] {
  const byMonth = new Map<string, PrRow[]>()
  for (const row of rows) {
    pushTo(byMonth, row.mergedAt.slice(0, 7), row)
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, monthRows]) => aggregate(month, monthRows))
}

// ============================================
// OUTPUT
// ============================================

const usd = (value: number): string => `$${value.toFixed(2)}`
const pct = (part: number, whole: number): string =>
  whole === 0 ? '0%' : `${((part / whole) * 100).toFixed(1)}%`

/** `a:$1.00 b:$0.50`, largest first. Model ids lose their `claude-` prefix to stay readable. */
function breakdown(map: Map<string, number>, limit = Infinity): string {
  return [...map.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([key, value]) => `${key.replace(/^claude-/, '')}:${usd(value)}`)
    .join(' ')
}

function table(header: string[], body: string[][]): string {
  const widths = header.map((cell, i) =>
    Math.max(cell.length, ...body.map((row) => row[i]!.length)),
  )
  const format = (row: string[]) =>
    row
      .map((cell, i) => cell.padEnd(widths[i]!))
      .join('  ')
      .trimEnd()
  return [
    format(header),
    format(widths.map((width) => '-'.repeat(width))),
    ...body.map(format),
  ].join('\n')
}

export function formatReport(report: Report, rows: PrRow[], split?: string): string {
  const prTable = table(
    [
      'PR',
      'Merged',
      'Total',
      'Input',
      'Write5m',
      'Write1h',
      'Read',
      'Output',
      'Turns',
      'Reqs',
      'Subagent',
      'Lines',
      '$/line',
      'Models',
      'Top skills',
    ],
    rows.map((row) => [
      `#${row.pr}`,
      row.mergedAt.slice(0, 10),
      usd(row.total),
      ...BILLING_TYPES.map((type) => usd(row.cost[type])),
      String(row.turns),
      String(row.requests),
      pct(row.subagentCost, row.total),
      String(row.changedLines),
      row.changedLines === 0 ? '-' : `$${(row.total / row.changedLines).toFixed(3)}`,
      breakdown(row.byModel),
      breakdown(row.bySkill, 3),
    ]),
  )

  const aggregates = [aggregate('all', rows), ...monthlyAggregates(rows)]
  if (split) {
    aggregates.push(
      aggregate(
        `before ${split}`,
        rows.filter((row) => row.firstRequestAt < split),
      ),
    )
    aggregates.push(
      aggregate(
        `from ${split}`,
        rows.filter((row) => row.firstRequestAt >= split),
      ),
    )
  }
  const aggregateTable = table(
    ['Set', 'PRs', 'Median', 'p90', 'Total'],
    aggregates.map((a) => [a.label, String(a.prs), usd(a.median), usd(a.p90), usd(a.total)]),
  )

  const attributed = report.rows.reduce((sum, row) => sum + row.total, 0)
  const unattributedTotal = [...report.unattributed.values()].reduce((sum, value) => sum + value, 0)
  const buckets = table(
    ['Bucket', 'Cost', 'Share'],
    [
      ['attributed to merged PRs', usd(attributed), pct(attributed, report.total)],
      ['orchestrator overhead (auto/)', usd(report.overhead), pct(report.overhead, report.total)],
      ...[...report.unattributed.entries()].map(([reason, value]) => [
        `unattributed: ${reason}`,
        usd(value),
        pct(value, report.total),
      ]),
      [
        'total',
        usd(report.total),
        pct(attributed + report.overhead + unattributedTotal, report.total),
      ],
    ],
  )

  const sources = table(
    ['Source', 'Cost', 'Share'],
    [
      ...BILLING_TYPES.map((type) => [
        `billing: ${type}`,
        usd(report.byBillingType[type]),
        pct(report.byBillingType[type], report.total),
      ]),
      ...[...report.byModel.entries()]
        .sort(([, a], [, b]) => b - a)
        .map(([model, value]) => [`model: ${model}`, usd(value), pct(value, report.total)]),
      ...[...report.bySkill.entries()]
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([skill, value]) => [`skill: ${skill}`, usd(value), pct(value, report.total)]),
    ],
  )

  return [
    `Agent cost per merged PR — API list prices read ${PRICING_READ_ON}; a quota proxy, not dollars billed.`,
    '',
    prTable,
    '',
    aggregateTable,
    '',
    buckets,
    '',
    'All transcripts, attributed or not:',
    sources,
  ].join('\n')
}

export function toCsv(rows: PrRow[]): string {
  const header = [
    'pr',
    'merged_at',
    'first_request_at',
    'total_usd',
    ...BILLING_TYPES.map((type) => `${type}_usd`),
    'turns',
    'requests',
    'subagent_share',
    'changed_lines',
    'usd_per_changed_line',
    'by_model',
    'by_skill',
  ]
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`
  const lines = rows.map((row) =>
    [
      String(row.pr),
      row.mergedAt,
      row.firstRequestAt,
      row.total.toFixed(4),
      ...BILLING_TYPES.map((type) => row.cost[type].toFixed(4)),
      String(row.turns),
      String(row.requests),
      row.total === 0 ? '0' : (row.subagentCost / row.total).toFixed(4),
      String(row.changedLines),
      row.changedLines === 0 ? '' : (row.total / row.changedLines).toFixed(4),
      quote(breakdown(row.byModel)),
      quote(breakdown(row.bySkill)),
    ].join(','),
  )
  return [header.join(','), ...lines].join('\n') + '\n'
}

// ============================================
// CLI
// ============================================

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`)
  return value
}

/**
 * GitHub search returns at most 1,000 results whatever `--limit` says, and
 * `--search` makes `gh pr list` a search. So PRs are fetched one calendar
 * month at a time (~300 merges a month today), and a month that fills the cap
 * throws.
 */
export const PR_FETCH_LIMIT = 1000

/**
 * Work on a branch can outlive its merge (a cleanup session the next day), so
 * the PR window opens this long before the oldest request.
 */
const PR_WINDOW_SLACK_DAYS = 30

/** The earliest merge date that can own a request in these transcripts, as `YYYY-MM-DD`. */
export function prWindowStart(requests: RequestRecord[]): string {
  const oldest = requests.reduce(
    (min, request) => (request.timestamp && request.timestamp < min ? request.timestamp : min),
    new Date().toISOString(),
  )
  const start = new Date(oldest)
  start.setUTCDate(start.getUTCDate() - PR_WINDOW_SLACK_DAYS)
  return start.toISOString().slice(0, 10)
}

/**
 * `gh --limit` truncates without an error, and a PR missing from the list
 * moves its cost somewhere else: to unattributed, to `auto/` overhead, or onto
 * a newer PR on a reused branch. A full page is therefore a failure.
 */
export function assertUnderLimit(prs: MergedPr[], limit: number): MergedPr[] {
  if (prs.length >= limit) {
    throw new Error(
      `gh returned ${prs.length} merged PRs, the search cap; some would be missing and their cost misattributed. Fetch in smaller windows than a month.`,
    )
  }
  return prs
}

/**
 * Inclusive `[from, to]` date ranges, one per calendar month, covering `start`
 * through `end` (both `YYYY-MM-DD`). The first and last are partial months.
 */
export function monthWindows(start: string, end: string): Array<[string, string]> {
  const windows: Array<[string, string]> = []
  let from = start
  while (from <= end) {
    const lastOfMonth = new Date(`${from.slice(0, 7)}-01T00:00:00Z`)
    lastOfMonth.setUTCMonth(lastOfMonth.getUTCMonth() + 1, 0)
    const monthEnd = lastOfMonth.toISOString().slice(0, 10)
    const to = monthEnd < end ? monthEnd : end
    windows.push([from, to])
    lastOfMonth.setUTCDate(lastOfMonth.getUTCDate() + 1)
    from = lastOfMonth.toISOString().slice(0, 10)
  }
  return windows
}

function fetchMergedPrs(mergedSince: string): MergedPr[] {
  const today = new Date().toISOString().slice(0, 10)
  return monthWindows(mergedSince, today).flatMap(([from, to]) => {
    const args = [
      'pr',
      'list',
      '--state',
      'merged',
      '--search',
      `merged:${from}..${to}`,
      '--limit',
      String(PR_FETCH_LIMIT),
      '--json',
      'number,headRefName,mergedAt,additions,deletions',
    ]
    const run = () => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    let json: string
    try {
      json = run()
    } catch {
      // One call per month makes a transient GitHub 502 likely enough over a
      // long window to be worth one retry; a second failure is real.
      json = run()
    }
    return assertUnderLimit(JSON.parse(json) as MergedPr[], PR_FETCH_LIMIT)
  })
}

function main(): void {
  const args = process.argv.slice(2)
  const projectsDir = flag(args, '--projects-dir') ?? path.join(os.homedir(), '.claude', 'projects')
  const prsFile = flag(args, '--prs')
  const since = flag(args, '--since')
  const split = flag(args, '--split') && isoInstant(flag(args, '--split'))
  const out =
    flag(args, '--out') ??
    path.join(os.tmpdir(), `agent-cost-per-pr-${new Date().toISOString().slice(0, 10)}.csv`)

  const transcripts = readTranscripts(projectsDir)
  const prs = prsFile
    ? (JSON.parse(readFileSync(prsFile, 'utf8')) as MergedPr[])
    : fetchMergedPrs(prWindowStart(transcripts.requests))
  const report = buildReport(transcripts, prs)
  const rows = since ? report.rows.filter((row) => row.mergedAt >= since) : report.rows

  console.log(formatReport(report, rows, split))
  writeFileSync(out, toCsv(rows))
  console.log(`\nCSV: ${out}`)
}

// Guarded so the unit test can import the pure helpers without running the walk.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  try {
    main()
  } catch (error: unknown) {
    console.error(
      `\nagent-cost failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  }
}
