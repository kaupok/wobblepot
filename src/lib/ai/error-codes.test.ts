import { describe, it, expect } from 'vitest'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { ACCOUNT_DELETION_ERROR_KEYS } from '@/lib/account-deletion-error-codes'
import {
  IMAGINE_ERROR_KEYS,
  MEAL_PLAN_GENERATE_ERROR_KEYS,
  RECIPE_IMPORT_ERROR_KEYS,
  mealPlanGenerateFallbackKey,
  translateErrorCode,
} from './error-codes'

/**
 * The contract these maps exist to hold: a code the route can emit always
 * resolves to a key that exists in *both* catalogs. `catalogue-parity.test.ts`
 * proves en/et agree with each other; it cannot know that a key is referenced
 * from a map, so a code pointing at a key that exists in neither would pass
 * there and render the raw key path to the user.
 */
const surfaces = [
  {
    name: 'recipes.imagine.errors',
    keys: IMAGINE_ERROR_KEYS,
    en: enMessages.recipes.imagine.errors as Record<string, unknown>,
    et: etMessages.recipes.imagine.errors as Record<string, unknown>,
    fallback: 'generic',
  },
  {
    name: 'recipes.import.errors',
    keys: RECIPE_IMPORT_ERROR_KEYS,
    en: enMessages.recipes.import.errors as Record<string, unknown>,
    et: etMessages.recipes.import.errors as Record<string, unknown>,
    fallback: 'parseGeneric',
  },
  {
    name: 'meal-plan.errors',
    keys: MEAL_PLAN_GENERATE_ERROR_KEYS,
    en: enMessages['meal-plan'].errors as Record<string, unknown>,
    et: etMessages['meal-plan'].errors as Record<string, unknown>,
    fallback: 'generationFailed',
  },
  // Not an AI surface, but the same contract — kept here so one suite covers
  // every code map `translateErrorCode` is handed (HON-725).
  {
    name: 'profile.delete.errors',
    keys: ACCOUNT_DELETION_ERROR_KEYS,
    en: enMessages.profile.delete.errors as Record<string, unknown>,
    et: etMessages.profile.delete.errors as Record<string, unknown>,
    fallback: 'deleteFailed',
  },
] as const

describe('AI error-code maps', () => {
  it.each(surfaces)('$name: every code maps to a key present in en.json', ({ keys, en }) => {
    const missing = Object.values(keys).filter((key) => typeof en[key] !== 'string')
    expect(missing).toEqual([])
  })

  it.each(surfaces)('$name: every code maps to a key present in et.json', ({ keys, et }) => {
    const missing = Object.values(keys).filter((key) => typeof et[key] !== 'string')
    expect(missing).toEqual([])
  })

  it.each(surfaces)(
    '$name: the generic fallback key exists in both catalogs',
    ({ en, et, fallback }) => {
      expect(typeof en[fallback]).toBe('string')
      expect(typeof et[fallback]).toBe('string')
    },
  )

  it.each(surfaces)('$name: the Estonian copy differs from the English', ({ keys, en, et }) => {
    // A key copied across untranslated would satisfy parity and the two
    // lookups above while still showing English to an Estonian household.
    const untranslated = Object.values(keys).filter((key) => en[key] === et[key])
    expect(untranslated).toEqual([])
  })
})

describe('translateErrorCode', () => {
  it('maps a known code to its message key', () => {
    expect(translateErrorCode('imagine_timeout', IMAGINE_ERROR_KEYS, 'generic')).toBe(
      'imagineTimeout',
    )
    expect(translateErrorCode('robots_disallowed', RECIPE_IMPORT_ERROR_KEYS, 'parseGeneric')).toBe(
      'robotsDisallowed',
    )
  })

  it('falls back for a code this build does not know', () => {
    expect(translateErrorCode('code_from_a_newer_deploy', IMAGINE_ERROR_KEYS, 'generic')).toBe(
      'generic',
    )
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 500],
    ['an object', { code: 'imagine_timeout' }],
  ])('falls back when the code is %s', (_label, code) => {
    expect(translateErrorCode(code, IMAGINE_ERROR_KEYS, 'generic')).toBe('generic')
  })

  it('does not resolve inherited Object.prototype keys as codes', () => {
    // `keys[code]` on a plain object would otherwise turn `constructor` or
    // `toString` into a truthy "key" and render something meaningless.
    expect(translateErrorCode('toString', IMAGINE_ERROR_KEYS, 'generic')).toBe('generic')
    expect(translateErrorCode('constructor', IMAGINE_ERROR_KEYS, 'generic')).toBe('generic')
  })
})

describe('mealPlanGenerateFallbackKey', () => {
  it('keeps the timeout and rate-limit copy for a body with no code', () => {
    expect(mealPlanGenerateFallbackKey(504)).toBe('generationTimeout')
    expect(mealPlanGenerateFallbackKey(429)).toBe('rateLimit')
    expect(mealPlanGenerateFallbackKey(500)).toBe('generationFailed')
    expect(mealPlanGenerateFallbackKey(400)).toBe('generationFailed')
  })

  it('returns keys present in both catalogs', () => {
    for (const status of [504, 429, 500]) {
      const key = mealPlanGenerateFallbackKey(
        status,
      ) as keyof (typeof enMessages)['meal-plan']['errors']
      expect(typeof enMessages['meal-plan'].errors[key]).toBe('string')
      expect(typeof etMessages['meal-plan'].errors[key]).toBe('string')
    }
  })
})
