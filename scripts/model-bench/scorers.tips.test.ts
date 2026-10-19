// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { CaseOf } from './case-schema'
import { loadCases } from './load-cases'
import { scoreTips } from './scorers'

function starter(id: string): CaseOf<'tips'>['input'] {
  const found = loadCases(['tips']).find((c) => c.id === `tips/${id}`)
  if (!found) throw new Error(`No starter case tips/${id}`)
  return found.input as CaseOf<'tips'>['input']
}

describe('scoreTips', () => {
  const full = starter('en-full-bolognese')
  const supplementary = starter('et-supplementary-ahjulohe')
  const items = (n: number) => Array.from({ length: n }, (_, i) => `item ${i + 1}`)

  it('passes full tips within every range', () => {
    const scores = scoreTips(full, { equipment: items(4), steps: items(5), pitfalls: items(2) })
    expect(scores).toEqual({ answered: 1, countsInRange: 1 })
  })

  it('scores whether the adjustment instruction reached the answer (HON-1244)', () => {
    const adjusted = { ...full, adjustmentNote: 'Less salt', followsAny: ['salt'] }
    const answer = { equipment: items(4), steps: items(5), pitfalls: items(2) }
    expect(scoreTips(adjusted, answer).followsNote).toBe(0)
    expect(scoreTips(adjusted, { ...answer, tip: 'Skip the extra Salt.' }).followsNote).toBe(1)
  })

  it('fails an answer that names a left-out ingredient in any field (HON-1254)', () => {
    const changed = { ...full, hasChanges: true, omitsAll: ['garlic', 'chilli'] }
    const answer = { equipment: items(4), steps: items(5), pitfalls: items(2), tip: 'Salt well.' }
    expect(scoreTips(changed, answer).omitsLeftOut).toBe(1)
    expect(scoreTips(changed, { ...answer, equipment: ['Garlic press'] }).omitsLeftOut).toBe(0)
    expect(scoreTips(changed, { ...answer, steps: ['Fry the chilli.'] }).omitsLeftOut).toBe(0)
    expect(scoreTips(changed, { ...answer, pitfalls: ['Burnt garlic'] }).omitsLeftOut).toBe(0)
    expect(scoreTips(changed, { ...answer, tip: 'Add CHILLI last.' }).omitsLeftOut).toBe(0)
    expect(scoreTips(full, answer)).not.toHaveProperty('omitsLeftOut')
  })

  it('detects full tips with 9 steps', () => {
    const scores = scoreTips(full, { equipment: items(4), steps: items(9), pitfalls: items(2) })
    expect(scores.countsInRange).toBe(0)
  })

  it('detects supplementary tips with an empty tip or too many pitfalls', () => {
    expect(
      scoreTips(supplementary, { pitfalls: items(2), tip: 'Pat the salmon dry.' }).countsInRange,
    ).toBe(1)
    expect(scoreTips(supplementary, { pitfalls: items(2), tip: '  ' }).countsInRange).toBe(0)
    expect(scoreTips(supplementary, { pitfalls: items(4), tip: 'x' })).toEqual({
      answered: 1,
      countsInRange: 0,
    })
  })
})
