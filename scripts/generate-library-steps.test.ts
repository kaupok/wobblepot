import { describe, expect, it } from 'vitest'
import { parseArgs, selectWork, type StepsCandidate } from './generate-library-steps'

const edited = new Date('2026-10-01T10:00:00Z')
const earlier = new Date('2026-09-01T10:00:00Z')

const meal = (overrides: Partial<StepsCandidate> = {}): StepsCandidate => ({
  id: 'meal-1',
  name: 'Beef Bibimbap',
  updatedAt: edited,
  preparationSteps: [],
  ...overrides,
})

describe('selectWork', () => {
  it('writes a row for every locale a meal lacks', () => {
    expect(selectWork([meal()], ['en', 'et'])).toEqual([
      { mealId: 'meal-1', name: 'Beef Bibimbap', locale: 'en', reason: 'missing' },
      { mealId: 'meal-1', name: 'Beef Bibimbap', locale: 'et', reason: 'missing' },
    ])
  })

  it('rewrites a row written before the meal was last edited, and keeps a fresh one', () => {
    const candidate = meal({
      preparationSteps: [
        { locale: 'en', mealUpdatedAt: earlier },
        { locale: 'et', mealUpdatedAt: edited },
      ],
    })
    expect(selectWork([candidate], ['en', 'et'])).toEqual([
      { mealId: 'meal-1', name: 'Beef Bibimbap', locale: 'en', reason: 'stale' },
    ])
  })

  it('only looks at the locales asked for', () => {
    expect(selectWork([meal()], ['et'])).toEqual([
      { mealId: 'meal-1', name: 'Beef Bibimbap', locale: 'et', reason: 'missing' },
    ])
  })
})

describe('parseArgs', () => {
  it('is a dry run over both locales by default', () => {
    expect(parseArgs([])).toEqual({ confirm: false, locales: ['en', 'et'] })
  })

  it('reads the flags', () => {
    expect(parseArgs(['--confirm', '--locale=et', '--meal=Beef Bibimbap', '--limit=3'])).toEqual({
      confirm: true,
      locales: ['et'],
      meal: 'Beef Bibimbap',
      limit: 3,
    })
  })

  it('rejects a locale the app does not know', () => {
    expect(() => parseArgs(['--locale=fr'])).toThrow('Unknown locale: fr')
  })
})
