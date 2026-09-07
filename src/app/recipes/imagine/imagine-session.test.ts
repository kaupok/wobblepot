import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ImaginedMealResponse } from '@/lib/imagine-utils'
import {
  IMAGINE_ROUTE,
  clearImagineSession,
  loadImagineSession,
  saveImagineSession,
} from './imagine-session'

const STORAGE_KEY = 'imagined-meals'

function meal(id: string, name: string): ImaginedMealResponse {
  return {
    id,
    name,
    description: 'Generated from your prompt.',
    timeMinutes: 25,
    servings: 4,
    suitableFor: ['dinner'],
    kidFriendly: true,
    primaryProteinType: 'legume',
    components: [],
    nutrition: { calories: 480, protein: 24, carbs: 62, fat: 12 },
    ingredients: [],
    allMatched: true,
  }
}

describe('imagine-session', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes the route the create form routes Cancel back to', () => {
    expect(IMAGINE_ROUTE).toBe('/recipes/imagine')
  })

  it('round-trips the prompt and meals', () => {
    saveImagineSession({ prompt: 'something with lentils', meals: [meal('im-1', 'Lentil stew')] })

    const loaded = loadImagineSession()
    expect(loaded?.prompt).toBe('something with lentils')
    expect(loaded?.meals.map((m) => m.name)).toEqual(['Lentil stew'])
  })

  it('stamps createdAt so the caller does not have to', () => {
    vi.setSystemTime(new Date('2026-09-07T12:00:00Z'))
    saveImagineSession({ prompt: 'anything', meals: [] })
    expect(loadImagineSession()?.createdAt).toBe(Date.parse('2026-09-07T12:00:00Z'))
    vi.useRealTimers()
  })

  it('replaces a previous session rather than merging with it', () => {
    saveImagineSession({ prompt: 'first', meals: [meal('im-1', 'First')] })
    saveImagineSession({ prompt: 'second', meals: [meal('im-2', 'Second')] })

    const loaded = loadImagineSession()
    expect(loaded?.prompt).toBe('second')
    expect(loaded?.meals.map((m) => m.id)).toEqual(['im-2'])
  })

  it('returns null when nothing is stored', () => {
    expect(loadImagineSession()).toBeNull()
  })

  it('clears the stash', () => {
    saveImagineSession({ prompt: 'anything', meals: [] })
    clearImagineSession()

    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(loadImagineSession()).toBeNull()
  })

  it.each([
    ['unparseable JSON', 'not json at all'],
    ['a JSON primitive', '"just a string"'],
    ['null', 'null'],
    ['an empty object', '{}'],
    ['a non-string prompt', JSON.stringify({ prompt: 7, meals: [], createdAt: 1 })],
    ['a missing createdAt', JSON.stringify({ prompt: 'x', meals: [] })],
    ['a non-array meals', JSON.stringify({ prompt: 'x', meals: 'nope', createdAt: 1 })],
    ['a meal that is not an object', JSON.stringify({ prompt: 'x', meals: [3], createdAt: 1 })],
    [
      'a meal missing its name',
      JSON.stringify({ prompt: 'x', meals: [{ id: 'im-1' }], createdAt: 1 }),
    ],
    // The next four are the fields `MealCardBase` dereferences on restore. An
    // `{ id, name }`-only meal used to pass here and then take the page to the
    // error boundary instead of degrading to an empty prompt.
    [
      'a meal with only id and name',
      JSON.stringify({ prompt: 'x', meals: [{ id: 'im-1', name: 'Stew' }], createdAt: 1 }),
    ],
    [
      'a meal missing nutrition',
      JSON.stringify({
        prompt: 'x',
        meals: [{ id: 'im-1', name: 'Stew', primaryProteinType: 'legume', components: [] }],
        createdAt: 1,
      }),
    ],
    [
      'a meal whose nutrition is null',
      JSON.stringify({
        prompt: 'x',
        meals: [
          {
            id: 'im-1',
            name: 'Stew',
            primaryProteinType: 'legume',
            components: [],
            nutrition: null,
          },
        ],
        createdAt: 1,
      }),
    ],
    [
      'a meal missing components',
      JSON.stringify({
        prompt: 'x',
        meals: [
          { id: 'im-1', name: 'Stew', primaryProteinType: 'legume', nutrition: { calories: 1 } },
        ],
        createdAt: 1,
      }),
    ],
    [
      'a meal missing primaryProteinType',
      JSON.stringify({
        prompt: 'x',
        meals: [{ id: 'im-1', name: 'Stew', components: [], nutrition: { calories: 1 } }],
        createdAt: 1,
      }),
    ],
  ])('returns null (and does not throw) for %s', (_label, stored) => {
    sessionStorage.setItem(STORAGE_KEY, stored)
    expect(() => loadImagineSession()).not.toThrow()
    expect(loadImagineSession()).toBeNull()
  })

  it('degrades to no-stash when storage itself throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {
        throw new Error('SecurityError')
      },
    }
    vi.stubGlobal('sessionStorage', throwing)
    // `window.sessionStorage` is what the module reads; jsdom's `window` is the
    // same object as `globalThis`, but stub it explicitly so the intent is clear.
    vi.stubGlobal('window', { ...window, sessionStorage: throwing })

    expect(() => saveImagineSession({ prompt: 'x', meals: [] })).not.toThrow()
    expect(() => clearImagineSession()).not.toThrow()
    expect(loadImagineSession()).toBeNull()
  })
})
