import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Validates a `/judge` verdict, checks each citation against the text it
 * claims to quote, and renders the Linear comment and label (HON-1514).
 *
 * The subagent that wrote the verdict never supplies the text a quote is
 * checked against: code and docs come from git at `--ref`, and Linear text
 * comes from files the main session fetched itself. A judge that invents a
 * precedent is worse than no judge, so a Decide with no verified quote is held.
 */

export const MOVES = ['decide', 'send_back', 'hold'] as const
export const OUTCOMES = ['real', 'wont_fix'] as const
export const SEND_BACK_REASONS = ['stale', 'duplicate', 'no_evidence', 'misread'] as const
const HOLD_REASON = /^(?:hard_gate:[a-z][a-z-]*|no_precedent|options_open|no_verifiable_precedent)$/

export interface Citation {
  source: string
  quote: string
}

export interface Verdict {
  issue: string
  move: (typeof MOVES)[number]
  outcome?: (typeof OUTCOMES)[number]
  sendBackReason?: (typeof SEND_BACK_REASONS)[number]
  holdReason?: string
  duplicateOf?: string
  citations: Citation[]
  reasoning: string
}

const ISSUE_ID = /^[A-Z]+-\d+$/

function oneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value)
}

/** Throws with every problem at once, so one re-ask of the subagent fixes them all. */
export function validateVerdict(raw: unknown): Verdict {
  const v = (raw ?? {}) as Record<string, unknown>
  const problems: string[] = []
  if (typeof v.issue !== 'string' || !ISSUE_ID.test(v.issue)) problems.push('issue: not an ID')
  if (!oneOf(v.move, MOVES)) problems.push(`move: one of ${MOVES.join(', ')}`)
  if (v.move === 'decide' && !oneOf(v.outcome, OUTCOMES)) {
    problems.push(`outcome: one of ${OUTCOMES.join(', ')} when move is decide`)
  }
  if (v.move === 'send_back') {
    if (!oneOf(v.sendBackReason, SEND_BACK_REASONS)) {
      problems.push(`sendBackReason: one of ${SEND_BACK_REASONS.join(', ')}`)
    } else if (
      v.sendBackReason === 'duplicate' &&
      (typeof v.duplicateOf !== 'string' || !ISSUE_ID.test(v.duplicateOf))
    ) {
      problems.push('duplicateOf: an issue ID when sendBackReason is duplicate')
    }
  }
  if (v.move === 'hold' && (typeof v.holdReason !== 'string' || !HOLD_REASON.test(v.holdReason))) {
    problems.push('holdReason: hard_gate:<name>, no_precedent or options_open')
  }
  const citations = Array.isArray(v.citations) ? (v.citations as unknown[]) : null
  if (!citations) problems.push('citations: an array')
  citations?.forEach((c, i) => {
    const { source, quote } = (c ?? {}) as Record<string, unknown>
    if (typeof source !== 'string' || source.trim() === '') problems.push(`citations[${i}].source`)
    if (typeof quote !== 'string' || quote.trim() === '') problems.push(`citations[${i}].quote`)
    else if (quote.trim().split('\n').length > 2) problems.push(`citations[${i}].quote: 2 lines`)
  })
  if (typeof v.reasoning !== 'string' || v.reasoning.trim() === '') problems.push('reasoning')
  if (problems.length > 0) throw new Error(`invalid verdict: ${problems.join('; ')}`)
  return v as unknown as Verdict
}

export interface Readers {
  /** The file's text at the judged commit, or null when it does not exist there. */
  file: (repoPath: string) => string | null
  /** The fetched description and comments of a Linear issue, or null when not fetched. */
  linear: (issueId: string) => string | null
}

export function gitReaders(ref: string, linearDir: string | undefined, cwd: string): Readers {
  return {
    file: (repoPath) => {
      try {
        return execFileSync('git', ['show', `${ref}:${repoPath}`], {
          cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          maxBuffer: 64 * 1024 * 1024,
        })
      } catch {
        return null
      }
    },
    linear: (issueId) => {
      if (!linearDir) return null
      const file = path.join(linearDir, `${issueId}.txt`)
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
    },
  }
}

/** `HON-123 comment …` is Linear; `docs/X.md → Heading` and `src/x.ts:42` are files. */
export function citationTarget(source: string): { kind: 'linear' | 'file'; id: string } {
  const linear = /^([A-Z]+-\d+)\b/.exec(source.trim())?.[1]
  if (linear) return { kind: 'linear', id: linear }
  const first = source.trim().split(/\s|→/)[0] ?? ''
  const file = first.replace(/:\d+(?:-\d+)?$/, '')
  return { kind: 'file', id: file }
}

const normalise = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Null when the quote is verbatim in its source (whitespace aside), else the reason it is not. */
export function checkCitation(citation: Citation, readers: Readers): string | null {
  const target = citationTarget(citation.source)
  const text = target.kind === 'linear' ? readers.linear(target.id) : readers.file(target.id)
  if (text === null) {
    return target.kind === 'linear'
      ? `${target.id} was not fetched`
      : `${target.id} does not exist at the judged commit`
  }
  return normalise(text).includes(normalise(citation.quote))
    ? null
    : `quote not found in ${target.id}`
}

export interface Finalized {
  verdict: Verdict
  dropped: { citation: Citation; reason: string }[]
  label: string
  heading: string
  comment: string
}

export const OVERRULE_LINE =
  'To overrule: reply under this comment with the right answer and one line of why, then add the `Judge overruled` label.'

export function labelFor(verdict: Verdict): string {
  if (verdict.move === 'decide') {
    return verdict.outcome === 'real' ? 'Judge: real' : "Judge: won't fix"
  }
  return verdict.move === 'send_back' ? 'Judge: sent back' : 'Judge: held'
}

function holdText(reason: string): string {
  return reason.startsWith('hard_gate:')
    ? `hard gate: ${reason.slice('hard_gate:'.length)}`
    : reason.replace(/_/g, ' ')
}

export function headingFor(verdict: Verdict): string {
  switch (verdict.move) {
    case 'decide':
      return `## Judge: Decide — ${verdict.outcome === 'real' ? 'real' : "won't fix"}`
    case 'send_back':
      return verdict.sendBackReason === 'duplicate'
        ? `## Judge: Send back — duplicate of ${verdict.duplicateOf}`
        : `## Judge: Send back — ${(verdict.sendBackReason ?? '').replace(/_/g, ' ')}`
    case 'hold':
      return `## Judge: Hold — ${holdText(verdict.holdReason ?? '')}`
  }
}

function renderComment(verdict: Verdict, heading: string, dropped: Finalized['dropped']): string {
  const lines = [heading, '']
  if (verdict.citations.length === 0) {
    lines.push('**Citations:** none', '')
  } else {
    lines.push('**Citations:**', '')
    for (const c of verdict.citations) {
      lines.push(
        `- ${c.source}`,
        ...c.quote
          .trim()
          .split('\n')
          .map((q) => `  > ${q}`),
      )
    }
    lines.push('')
  }
  lines.push(`**Reasoning:** ${verdict.reasoning.trim()}`, '')
  if (dropped.length > 0) {
    lines.push('**Dropped citations** (not verified, so not used):', '')
    for (const d of dropped) lines.push(`- ${d.citation.source}: ${d.reason}`)
    lines.push('')
  }
  lines.push(OVERRULE_LINE)
  return lines.join('\n')
}

/** Keep the verified citations; a Decide left with none becomes Hold. */
export function finalizeVerdict(raw: unknown, readers: Readers): Finalized {
  const input = validateVerdict(raw)
  const dropped: Finalized['dropped'] = []
  const citations = input.citations.filter((citation) => {
    // The finding is not its own precedent.
    const reason =
      citationTarget(citation.source).id === input.issue
        ? 'cites the judged issue itself'
        : checkCitation(citation, readers)
    if (reason !== null) dropped.push({ citation, reason })
    return reason === null
  })
  let verdict: Verdict = { ...input, citations }
  if (verdict.move === 'decide' && citations.length === 0) {
    verdict = {
      issue: verdict.issue,
      move: 'hold',
      holdReason: 'no_verifiable_precedent',
      citations,
      reasoning: verdict.reasoning,
    }
  }
  const heading = headingFor(verdict)
  return {
    verdict,
    dropped,
    label: labelFor(verdict),
    heading,
    comment: renderComment(verdict, heading, dropped),
  }
}

export interface ListedIssue {
  id: string
  title: string
  labels?: (string | { name: string })[]
}

/** Open `[AUTO DRAFT]` issues with no `Judge:` label; `rejudge` keeps the labelled ones. */
export function selectIssues(
  issues: ListedIssue[],
  { rejudge }: { rejudge: boolean },
): { selected: string[]; skipped: { id: string; reason: string }[] } {
  const selected: string[] = []
  const skipped: { id: string; reason: string }[] = []
  for (const issue of issues) {
    const labels = (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name))
    const judged = labels.find((l) => l.startsWith('Judge:'))
    if (!issue.title.startsWith('[AUTO DRAFT]')) {
      skipped.push({ id: issue.id, reason: 'title does not start with [AUTO DRAFT]' })
    } else if (judged && !rejudge) {
      skipped.push({ id: issue.id, reason: `already judged (${judged}); pass --rejudge` })
    } else {
      selected.push(issue.id)
    }
  }
  return { selected, skipped }
}
