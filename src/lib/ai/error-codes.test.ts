import { describe, it, expect } from 'vitest'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { ACCOUNT_DELETION_ERROR_KEYS } from '@/lib/account-deletion-error-codes'
import {
  COOK_QUESTION_ERROR_KEYS,
  IMAGINE_ERROR_KEYS,
  MEAL_PLAN_GENERATE_ERROR_KEYS,
  PREPARATION_STEPS_ERROR_KEYS,
  RECIPE_IMPORT_ERROR_KEYS,
  cookQuestionFallbackKey,
  mealPlanGenerateFallbackKey,
  preparationStepsFallbackKey,
  rateLimitMessage,
  rateLimitResetAt,
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
  {
    name: 'meal-plan.steps.errors',
    keys: PREPARATION_STEPS_ERROR_KEYS,
    en: enMessages['meal-plan'].steps.errors as Record<string, unknown>,
    et: etMessages['meal-plan'].steps.errors as Record<string, unknown>,
    fallback: 'tipsFailed',
  },
  {
    name: 'meal-plan.cookQuestion.errors',
    keys: COOK_QUESTION_ERROR_KEYS,
    en: enMessages['meal-plan'].cookQuestion.errors as Record<string, unknown>,
    et: etMessages['meal-plan'].cookQuestion.errors as Record<string, unknown>,
    fallback: 'questionFailed',
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

describe('preparationStepsFallbackKey', () => {
  it('keeps the timeout copy for a codeless 504 and is generic otherwise', () => {
    expect(preparationStepsFallbackKey(504)).toBe('tipsTimeout')
    expect(preparationStepsFallbackKey(500)).toBe('tipsFailed')
    expect(preparationStepsFallbackKey(429)).toBe('tipsFailed')
  })

  it('returns keys present in both catalogs', () => {
    for (const status of [504, 500]) {
      const key = preparationStepsFallbackKey(
        status,
      ) as keyof (typeof enMessages)['meal-plan']['steps']['errors']
      expect(typeof enMessages['meal-plan'].steps.errors[key]).toBe('string')
      expect(typeof etMessages['meal-plan'].steps.errors[key]).toBe('string')
    }
  })
})

describe('cookQuestionFallbackKey', () => {
  it('keeps the timeout copy for a codeless 504 and is generic otherwise', () => {
    expect(cookQuestionFallbackKey(504)).toBe('questionTimeout')
    expect(cookQuestionFallbackKey(500)).toBe('questionFailed')
    expect(cookQuestionFallbackKey(429)).toBe('questionFailed')
  })
})

/**
 * Every rate-limit key a callsite hands `rateLimitMessage`, with its namespace
 * in both catalogs. The helper derives the `…Until` sibling by name, so a
 * missing one would render the raw key path rather than fail a type check.
 */
const rateLimitSurfaces = [
  {
    name: 'recipes.imagine.errors',
    key: IMAGINE_ERROR_KEYS.rate_limited,
    en: enMessages.recipes.imagine.errors as Record<string, unknown>,
    et: etMessages.recipes.imagine.errors as Record<string, unknown>,
  },
  {
    name: 'recipes.import.errors',
    key: RECIPE_IMPORT_ERROR_KEYS.rate_limited,
    en: enMessages.recipes.import.errors as Record<string, unknown>,
    et: etMessages.recipes.import.errors as Record<string, unknown>,
  },
  {
    name: 'meal-plan.errors',
    key: MEAL_PLAN_GENERATE_ERROR_KEYS.rate_limited,
    en: enMessages['meal-plan'].errors as Record<string, unknown>,
    et: etMessages['meal-plan'].errors as Record<string, unknown>,
  },
  {
    name: 'meal-plan.steps.errors',
    key: PREPARATION_STEPS_ERROR_KEYS.rate_limited,
    en: enMessages['meal-plan'].steps.errors as Record<string, unknown>,
    et: etMessages['meal-plan'].steps.errors as Record<string, unknown>,
  },
  {
    name: 'meal-plan.cookQuestion.errors',
    key: COOK_QUESTION_ERROR_KEYS.rate_limited,
    en: enMessages['meal-plan'].cookQuestion.errors as Record<string, unknown>,
    et: etMessages['meal-plan'].cookQuestion.errors as Record<string, unknown>,
  },
  {
    name: 'meal-plan.selector',
    key: 'rateLimited',
    en: enMessages['meal-plan'].selector as Record<string, unknown>,
    et: etMessages['meal-plan'].selector as Record<string, unknown>,
  },
] as const

describe('rate-limit …Until keys', () => {
  it.each(rateLimitSurfaces)(
    '$name: the …Until sibling exists in both catalogs with a {time} argument',
    ({ key, en, et }) => {
      expect(en[`${key}Until`]).toEqual(expect.stringContaining('{time}'))
      expect(et[`${key}Until`]).toEqual(expect.stringContaining('{time}'))
    },
  )
})

describe('rateLimitResetAt', () => {
  it('returns the date from an ISO resetAt', () => {
    expect(rateLimitResetAt({ resetAt: '2026-10-09T15:40:00.000Z' })).toEqual(
      new Date('2026-10-09T15:40:00.000Z'),
    )
  })

  it.each([
    ['no body', undefined],
    ['a null body', null],
    ['a string body', 'Too Many Requests'],
    ['a body without resetAt', { error: 'Rate limit exceeded' }],
    ['a numeric resetAt', { resetAt: 1_760_000_000_000 }],
    ['an unparseable resetAt', { resetAt: 'soon' }],
  ])('returns null for %s', (_label, body) => {
    expect(rateLimitResetAt(body)).toBeNull()
  })
})

describe('rateLimitMessage', () => {
  // 18:40 on the device clock, whatever TZ the test runs in.
  const resetAt = new Date(2026, 9, 9, 18, 40)
  const body = { code: 'rate_limited', resetAt: resetAt.toISOString() }

  it('picks the …Until key with the time in the household locale when resetAt is known', () => {
    expect(rateLimitMessage('rateLimited', 'rateLimited', body, 'et')).toEqual({
      key: 'rateLimitedUntil',
      values: { time: '18:40' },
    })
    expect(rateLimitMessage('rateLimit', 'rateLimit', body, 'en')).toEqual({
      key: 'rateLimitUntil',
      values: { time: '6:40 PM' },
    })
  })

  it('keeps the plain key when the body has no resetAt', () => {
    expect(rateLimitMessage('rateLimited', 'rateLimited', {}, 'en')).toEqual({
      key: 'rateLimited',
      values: {},
    })
  })

  it('passes any other key through, even with a resetAt in the body', () => {
    expect(rateLimitMessage('providerBusy', 'rateLimited', body, 'en')).toEqual({
      key: 'providerBusy',
      values: {},
    })
  })
})
