import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { run } from './cli'

let tmp: string

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-cli-'))
})

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

function fixture(name: string, value: unknown): string {
  const file = path.join(tmp, name)
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
  return file
}

describe('judge cli', () => {
  it('gate: reads label objects as Linear returns them', () => {
    const issue = fixture('issue.json', {
      title: '[AUTO DRAFT] Thing',
      description: 'plain',
      labels: [{ name: 'GTM' }],
    })
    expect(run(['gate', '--issue', issue])).toEqual({
      gate: { gate: 'gtm', kind: 'label', matched: 'GTM' },
    })
  })

  it('finalize: holds a hand-edited verdict whose quote is not in CLAUDE.md at HEAD', () => {
    const verdict = fixture('verdict.json', {
      issue: 'HON-1456',
      move: 'decide',
      outcome: 'real',
      citations: [{ source: 'CLAUDE.md → Testing', quote: 'A test may always pass.' }],
      reasoning: 'Edited by hand.',
    })
    const result = run(['finalize', '--verdict', verdict, '--ref', 'HEAD']) as {
      heading: string
    }
    expect(result.heading).toBe('## Judge: Hold — no verifiable precedent')
  })

  it('finalize: keeps a verdict whose quote is in CLAUDE.md at HEAD', () => {
    const verdict = fixture('verdict-ok.json', {
      issue: 'HON-1456',
      move: 'decide',
      outcome: 'real',
      citations: [{ source: 'CLAUDE.md → Testing', quote: 'A test must be able to fail.' }],
      reasoning: 'Real quote.',
    })
    const result = run(['finalize', '--verdict', verdict, '--ref', 'HEAD']) as { heading: string }
    expect(result.heading).toBe('## Judge: Decide — real')
  })

  it('select: reads { issues: [] } and the --rejudge flag', () => {
    const list = fixture('list.json', {
      issues: [{ id: 'HON-2', title: '[AUTO DRAFT] B', labels: ['Judge: real'] }],
    })
    expect(run(['select', '--issues', list])).toMatchObject({ selected: [] })
    expect(run(['select', '--issues', list, '--rejudge'])).toMatchObject({ selected: ['HON-2'] })
  })

  it('throws the usage on an unknown command', () => {
    expect(() => run(['nope'])).toThrow('Usage:')
  })
})
