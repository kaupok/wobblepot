import { describe, expect, it } from 'vitest'

import { parseArgs, selectWork, type StepsCandidate } from './generate-library-steps'

const meal = (overrides: Partial<StepsCandidate> = {}): StepsCandidate => ({
  id: 'meal-1',
  name: 'Beef Bibimbap',
  inputHashes: { en: 'hash-en', et: 'hash-et' },
  servings: 4,
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

  it('rewrites a row written from other inputs, and keeps a fresh one', () => {
    const candidate = meal({
      preparationSteps: [
        { locale: 'en', servings: 4, inputHash: 'hash-en-before-the-edit' },
        { locale: 'et', servings: 4, inputHash: 'hash-et' },
      ],
    })
    expect(selectWork([candidate], ['en', 'et'])).toEqual([
      { mealId: 'meal-1', name: 'Beef Bibimbap', locale: 'en', reason: 'stale' },
    ])
  })

  it("checks only the row at the meal's own servings, not the cook view's other counts", () => {
    const candidate = meal({
      preparationSteps: [
        // The cook view's rows at other counts (HON-1379): fresh-looking, but not the demo's.
        { locale: 'en', servings: 2, inputHash: 'hash-en' },
        { locale: 'en', servings: 6, inputHash: 'hash-en' },
        { locale: 'et', servings: 2.5, inputHash: 'hash-et' },
        { locale: 'et', servings: 4, inputHash: 'hash-et' },
      ],
    })
    expect(selectWork([candidate], ['en', 'et'])).toEqual([
      { mealId: 'meal-1', name: 'Beef Bibimbap', locale: 'en', reason: 'missing' },
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
