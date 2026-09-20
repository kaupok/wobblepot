import { describe, it, expect } from 'vitest'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { IMAGINE_ERROR_KEYS, RECIPE_IMPORT_ERROR_KEYS, translateErrorCode } from './error-codes'

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
    fallback: 'parseFailed',
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
    expect(translateErrorCode('robots_disallowed', RECIPE_IMPORT_ERROR_KEYS, 'parseFailed')).toBe(
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
