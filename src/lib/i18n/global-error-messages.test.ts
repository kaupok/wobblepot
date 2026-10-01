import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import {
  GLOBAL_ERROR_MESSAGES,
  detectClientLocale,
  globalErrorTranslator,
} from './global-error-messages'

/** Every `[dotted.path, string]` leaf under `node`. */
function leaves(node: unknown, prefix = ''): [string, unknown][] {
  if (typeof node !== 'object' || node === null) return [[prefix, node]]
  return Object.entries(node).flatMap(([key, value]) =>
    leaves(value, prefix ? `${prefix}.${key}` : key),
  )
}

function lookup(catalog: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], catalog)
}

describe('detectClientLocale', () => {
  const root = document.documentElement

  beforeEach(() => {
    root.removeAttribute('lang')
    root.removeAttribute('data-global-error')
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("prefers the root layout's <html lang>", () => {
    root.lang = 'et'

    expect(detectClientLocale()).toBe('et')
  })

  it("keeps the lang global error itself detected in the browser, so re-renders don't flip", () => {
    root.lang = 'et'
    root.setAttribute('data-global-error', 'client')

    expect(detectClientLocale()).toBe('et')
  })

  it('ignores the default lang of a server-rendered global error and reads the browser', () => {
    root.lang = 'en'
    root.setAttribute('data-global-error', 'server')
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fi', 'et-EE'])

    expect(detectClientLocale()).toBe('et')
  })

  it('ignores an unknown <html lang> and reads the browser', () => {
    root.lang = 'fr'
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['et'])

    expect(detectClientLocale()).toBe('et')
  })

  it('falls back to English when nothing matches', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR', 'de'])

    expect(detectClientLocale()).toBe('en')
  })
})

describe('GLOBAL_ERROR_MESSAGES', () => {
  const catalogs = { en: enMessages, et: etMessages }

  // The copy is mirrored rather than imported to keep the catalogs out of
  // every page's bundle; this is what keeps the mirror honest.
  it.each(Object.entries(catalogs))('matches messages/%s.json key for key', (locale, catalog) => {
    const mirrored = leaves(GLOBAL_ERROR_MESSAGES[locale as keyof typeof catalogs])
    expect(mirrored.length).toBeGreaterThan(0)
    for (const [path, value] of mirrored) {
      expect(lookup(catalog, path), path).toBe(value)
    }
  })
})

describe('globalErrorTranslator', () => {
  it('reads errors.global and the shared errors.boundary copy per locale', () => {
    expect(globalErrorTranslator('en')('global.title')).toBe('Something went wrong!')
    expect(globalErrorTranslator('et')('global.title')).toBe('Midagi läks valesti!')
    expect(globalErrorTranslator('et')('boundary.tryAgain')).toBe('Proovi uuesti')
  })
})
