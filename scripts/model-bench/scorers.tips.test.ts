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
  const notes = starter('et-notes-method-ahjulohe')
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

  // A method in the notes sets the step count, up to 12 (HON-1259).
  it('allows up to 12 steps from notes, and no more', () => {
    const answer = { equipment: items(3), pitfalls: items(2) }
    expect(scoreTips(notes, { ...answer, steps: items(12) }).countsInRange).toBe(1)
    expect(scoreTips(notes, { ...answer, steps: items(13) }).countsInRange).toBe(0)
    expect(scoreTips(notes, { ...answer, steps: items(3) }).countsInRange).toBe(0)
    expect(scoreTips(notes, { ...answer, steps: items(5), pitfalls: items(4) }).countsInRange).toBe(
      0,
    )
  })

  it("scores whether the steps keep the notes' times and temperatures", () => {
    const method = { ...notes, keepsAll: ['200', '20 min'] }
    const answer = { equipment: items(3), pitfalls: items(2), tip: 'Bake at 200°C for 20 min.' }
    const kept = ['Heat the oven to 200 °C.', 'Bake for 20 minutes.', 'Add the dill.', 'Serve.']
    expect(scoreTips(method, { ...answer, steps: kept }).keepsMethod).toBe(1)
    // Only the steps count: the tip does not make up for a lost temperature.
    const lost = ['Heat the oven.', 'Bake for 20 minutes.', 'Add the dill.', 'Serve.']
    expect(scoreTips(method, { ...answer, steps: lost }).keepsMethod).toBe(0)
    expect(scoreTips(full, { ...answer, steps: kept })).not.toHaveProperty('keepsMethod')
  })

  it('fails a step made from a note that is not a method, and lets the tip use it', () => {
    const noMethod = { ...notes, stepsOmitAll: ['grandma'] }
    const answer = { equipment: items(3), pitfalls: items(2), tip: "Grandma's way: ketchup." }
    const steps = ['Boil the potatoes.', 'Mash them.', 'Fry the meatballs.', 'Serve with ketchup.']
    expect(scoreTips(noMethod, { ...answer, steps }).noMadeUpStep).toBe(1)
    expect(
      scoreTips(noMethod, { ...answer, steps: [...steps, "Follow Grandma's recipe."] })
        .noMadeUpStep,
    ).toBe(0)
    expect(scoreTips(full, { ...answer, steps })).not.toHaveProperty('noMadeUpStep')
  })
})
