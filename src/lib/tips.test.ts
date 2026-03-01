import { describe, it, expect } from 'vitest'
import { parseStoredTips } from './tips'

describe('parseStoredTips', () => {
  it('returns structured tips with all fields', () => {
    const stored = JSON.stringify({
      equipment: ['Pan'],
      steps: ['Step 1'],
      pitfalls: ['Watch the heat'],
      tip: 'Use olive oil',
    })
    const result = parseStoredTips(stored)
    expect(result).toEqual({
      equipment: ['Pan'],
      steps: ['Step 1'],
      pitfalls: ['Watch the heat'],
      tip: 'Use olive oil',
    })
  })

  it('returns structured tips without tip field', () => {
    const stored = JSON.stringify({
      equipment: ['Pan'],
      steps: ['Step 1'],
      pitfalls: ['Watch the heat'],
    })
    const result = parseStoredTips(stored)
    expect(result).toEqual({
      equipment: ['Pan'],
      steps: ['Step 1'],
      pitfalls: ['Watch the heat'],
    })
  })

  it('returns supplementary tips (pitfalls + tip only)', () => {
    const stored = JSON.stringify({
      pitfalls: ["Don't overcook"],
      tip: 'Season well',
    })
    const result = parseStoredTips(stored)
    expect(result).toEqual({
      pitfalls: ["Don't overcook"],
      tip: 'Season well',
    })
  })

  it('returns null for plain text (old format)', () => {
    expect(parseStoredTips('Some plain text tips')).toBeNull()
  })

  it('returns null for JSON without pitfalls array', () => {
    const stored = JSON.stringify({ tip: 'Use olive oil' })
    expect(parseStoredTips(stored)).toBeNull()
  })

  it('returns null for empty object', () => {
    expect(parseStoredTips('{}')).toBeNull()
  })
})
