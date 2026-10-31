import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  citationTarget,
  finalizeVerdict,
  gitReaders,
  OVERRULE_LINE,
  type Readers,
  selectIssues,
  validateVerdict,
} from './verdict'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const docs: Record<string, string> = {
  'docs/DESIGN.md': '## Copy\n\nUse sentence case for all\nUI text.\n',
}
const linear: Record<string, string> = {
  'HON-900': 'Canceled: we keep the double tap on purpose, see the cook view spec.',
}
const readers: Readers = {
  file: (p) => docs[p] ?? null,
  linear: (id) => linear[id] ?? null,
}

const decide = {
  issue: 'HON-1456',
  move: 'decide',
  outcome: 'real',
  citations: [{ source: 'docs/DESIGN.md → Copy', quote: 'Use sentence case for all UI text.' }],
  reasoning: 'The button uses title case.',
}

describe('finalizeVerdict', () => {
  it('keeps a Decide whose quote is in the cited file, whitespace aside', () => {
    const result = finalizeVerdict(decide, readers)
    expect(result.heading).toBe('## Judge: Decide — real')
    expect(result.label).toBe('Judge: real')
    expect(result.dropped).toEqual([])
    expect(result.comment.split('\n')[0]).toBe('## Judge: Decide — real')
    expect(result.comment).toContain('  > Use sentence case for all UI text.')
    expect(result.comment.endsWith(OVERRULE_LINE)).toBe(true)
  })

  it('holds a Decide whose quote is not in the cited file', () => {
    const edited = {
      ...decide,
      citations: [{ source: 'docs/DESIGN.md → Copy', quote: 'Use title case for buttons.' }],
    }
    const result = finalizeVerdict(edited, readers)
    expect(result.verdict.move).toBe('hold')
    expect(result.verdict.outcome).toBeUndefined()
    expect(result.heading).toBe('## Judge: Hold — no verifiable precedent')
    expect(result.label).toBe('Judge: held')
    expect(result.dropped).toEqual([
      { citation: edited.citations[0], reason: 'quote not found in docs/DESIGN.md' },
    ])
    expect(result.comment).toContain('- docs/DESIGN.md → Copy: quote not found in docs/DESIGN.md')
  })

  it('holds a Decide that cites a file missing at the ref or an unfetched issue', () => {
    const result = finalizeVerdict(
      {
        ...decide,
        outcome: 'wont_fix',
        citations: [
          { source: 'docs/NOPE.md → X', quote: 'anything' },
          { source: 'HON-777 comment 2026-10-01', quote: 'anything' },
        ],
      },
      readers,
    )
    expect(result.heading).toBe('## Judge: Hold — no verifiable precedent')
    expect(result.dropped.map((d) => d.reason)).toEqual([
      'docs/NOPE.md does not exist at the judged commit',
      'HON-777 was not fetched',
    ])
  })

  it("verifies a Linear quote against the fetched text and labels won't fix", () => {
    const result = finalizeVerdict(
      {
        ...decide,
        outcome: 'wont_fix',
        citations: [
          { source: 'HON-900 comment 2026-10-21', quote: 'we keep the double tap on purpose' },
        ],
      },
      readers,
    )
    expect(result.heading).toBe("## Judge: Decide — won't fix")
    expect(result.label).toBe("Judge: won't fix")
  })

  it('drops a citation of the judged issue itself', () => {
    const result = finalizeVerdict(
      {
        ...decide,
        issue: 'HON-900',
        citations: [{ source: 'HON-900 description', quote: 'we keep the double tap on purpose' }],
      },
      readers,
    )
    expect(result.heading).toBe('## Judge: Hold — no verifiable precedent')
    expect(result.dropped.map((d) => d.reason)).toEqual(['cites the judged issue itself'])
  })

  it('keeps a Send back move when its citations fail, and renders each reason', () => {
    const stale = finalizeVerdict(
      {
        issue: 'HON-1',
        move: 'send_back',
        sendBackReason: 'no_evidence',
        citations: [{ source: 'x.ts', quote: 'q' }],
        reasoning: 'No file named.',
      },
      readers,
    )
    expect(stale.verdict.move).toBe('send_back')
    expect(stale.heading).toBe('## Judge: Send back — no evidence')
    expect(stale.label).toBe('Judge: sent back')
    expect(stale.comment).toContain('**Citations:** none')
  })

  const duplicate = {
    issue: 'HON-1',
    move: 'send_back',
    sendBackReason: 'duplicate',
    duplicateOf: 'HON-900',
    citations: [{ source: 'HON-900 description', quote: 'we keep the double tap on purpose' }],
    reasoning: 'Same finding.',
  }

  it('sends back a duplicate that quotes the open target', () => {
    const result = finalizeVerdict(duplicate, readers)
    expect(result.heading).toBe('## Judge: Send back — duplicate of HON-900')
    expect(result.label).toBe('Judge: sent back')
  })

  it('holds a duplicate with no verified quote from its target, or a closed target', () => {
    expect(finalizeVerdict({ ...duplicate, citations: [] }, readers).heading).toBe(
      '## Judge: Hold — no verifiable precedent',
    )
    const closed: Readers = {
      ...readers,
      linear: (id) => (id === 'HON-900' ? `Status: Canceled\n${linear['HON-900']}` : null),
    }
    expect(finalizeVerdict(duplicate, closed).heading).toBe(
      '## Judge: Hold — no verifiable precedent',
    )
  })

  it('rejects a duplicate of the judged issue itself', () => {
    expect(() => validateVerdict({ ...duplicate, duplicateOf: 'HON-1' })).toThrow(
      'duplicateOf: not the judged issue itself',
    )
  })

  it('renders a hard-gate Hold', () => {
    const result = finalizeVerdict(
      {
        issue: 'HON-2',
        move: 'hold',
        holdReason: 'hard_gate:irreversible',
        citations: [],
        reasoning: 'Touches a migration.',
      },
      readers,
    )
    expect(result.heading).toBe('## Judge: Hold — hard gate: irreversible')
    expect(result.label).toBe('Judge: held')
  })
})

describe('validateVerdict', () => {
  it('lists every problem at once', () => {
    expect(() =>
      validateVerdict({
        issue: 'x',
        move: 'decide',
        citations: [{ source: 'a', quote: '1\n2\n3' }],
      }),
    ).toThrow(
      'invalid verdict: issue: not an ID; outcome: one of real, wont_fix when move is decide; citations[0].quote: 2 lines; reasoning',
    )
  })

  it('needs duplicateOf for a duplicate', () => {
    expect(() =>
      validateVerdict({
        issue: 'HON-1',
        move: 'send_back',
        sendBackReason: 'duplicate',
        citations: [],
        reasoning: 'r',
      }),
    ).toThrow('duplicateOf')
  })
})

describe('citationTarget', () => {
  it('reads a file path with a heading or a line, and a Linear ID', () => {
    expect(citationTarget('docs/DESIGN.md → Reject list')).toEqual({
      kind: 'file',
      id: 'docs/DESIGN.md',
    })
    expect(citationTarget('src/lib/x.ts:42')).toEqual({ kind: 'file', id: 'src/lib/x.ts' })
    expect(citationTarget('HON-12 comment 2026-10-21')).toEqual({ kind: 'linear', id: 'HON-12' })
  })
})

describe('gitReaders', () => {
  it('reads a committed file at HEAD and returns null for a missing one', () => {
    const git = gitReaders('HEAD', undefined, repoRoot)
    expect(git.file('CLAUDE.md')).toContain('# Wobblepot - Code Guidelines')
    expect(git.file('docs/does-not-exist.md')).toBeNull()
    expect(git.linear('HON-1')).toBeNull()
  })
})

describe('selectIssues', () => {
  const issues = [
    { id: 'HON-1', title: '[AUTO DRAFT] A', labels: ['Bug'] },
    { id: 'HON-2', title: '[AUTO DRAFT] B', labels: [{ name: 'Judge: held' }] },
    { id: 'HON-3', title: '[DRAFT] C', labels: [] },
  ]

  it('skips an issue with a Judge: label', () => {
    expect(selectIssues(issues, { rejudge: false })).toEqual({
      selected: ['HON-1'],
      skipped: [
        { id: 'HON-2', reason: 'already judged (Judge: held); pass --rejudge' },
        { id: 'HON-3', reason: 'title does not start with [AUTO DRAFT]' },
      ],
    })
  })

  it('keeps it with rejudge', () => {
    expect(selectIssues(issues, { rejudge: true }).selected).toEqual(['HON-1', 'HON-2'])
  })
})
