import { describe, it, expect } from 'vitest'
import { parseCachedTips, parseStoredTips, serializeTips } from './tips'

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

describe('parseCachedTips', () => {
  const tips = { equipment: ['Pan'], steps: ['Sear'], pitfalls: ['Crowding'], tip: 'Rest it' }

  it('serves tips priced at the servings the entry cooks for now', () => {
    expect(parseCachedTips(serializeTips(tips, 2.5), { servings: 2.5, legacyServings: 3 })).toEqual(
      tips,
    )
  })

  it('drops tips priced at other servings', () => {
    expect(parseCachedTips(serializeTips(tips, 3), { servings: 2.5, legacyServings: 3 })).toBeNull()
  })

  // Tips cached before HON-1040 carry no servings and were priced at
  // `servingOverride ?? member count` — so were tips the old code wrote between
  // the production migration and the new code going live.
  it('reads a cache without servings as priced at the legacy servings', () => {
    const legacy = JSON.stringify(tips)
    expect(parseCachedTips(legacy, { servings: 2.5, legacyServings: 3 })).toBeNull()
    expect(parseCachedTips(legacy, { servings: 3, legacyServings: 3 })).toEqual(tips)
  })

  it('returns null for the old plain text format', () => {
    expect(parseCachedTips('Preheat the oven.', { servings: 2, legacyServings: 2 })).toBeNull()
  })
})
