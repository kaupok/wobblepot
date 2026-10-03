import { describe, it, expect } from 'vitest'
import { sameSubject } from './cook-question-subject'

describe('sameSubject', () => {
  it('matches kind and index, and never a missing subject', () => {
    expect(sameSubject({ kind: 'step', index: 1 }, { kind: 'step', index: 1 })).toBe(true)
    expect(sameSubject({ kind: 'step', index: 1 }, { kind: 'equipment', index: 1 })).toBe(false)
    expect(sameSubject({ kind: 'equipment', index: 0 }, { kind: 'equipment', index: 1 })).toBe(
      false,
    )
    expect(sameSubject(null, { kind: 'step', index: 0 })).toBe(false)
    expect(sameSubject(undefined, undefined)).toBe(false)
  })
})
