import { describe, it, expect } from 'vitest'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'

// Kept inline on purpose: a helper in src/lib/i18n is one import away from
// production code depending on it (HON-669).
function flatten(node: unknown, prefix = '', out = new Map<string, unknown>()) {
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
    for (const [key, value] of Object.entries(node)) {
      flatten(value, prefix ? `${prefix}.${key}` : key, out)
    }
  } else {
    out.set(prefix, node)
  }
  return out
}

const catalogues = {
  'en.json': flatten(enMessages),
  'et.json': flatten(etMessages),
}

describe('message catalogue parity', () => {
  it('en.json and et.json define the same keys', () => {
    const en = catalogues['en.json']
    const et = catalogues['et.json']
    const enOnly = [...en.keys()].filter((key) => !et.has(key)).sort()
    const etOnly = [...et.keys()].filter((key) => !en.has(key)).sort()

    expect(enOnly, 'keys present in en.json but missing from et.json').toEqual([])
    expect(etOnly, 'keys present in et.json but missing from en.json').toEqual([])
  })

  it.each(Object.entries(catalogues))('%s has no empty values', (file, messages) => {
    const empty = [...messages]
      .filter(([, value]) => typeof value === 'string' && value.trim() === '')
      .map(([key]) => key)

    expect(empty, `keys with an empty value in ${file}`).toEqual([])
  })
})
