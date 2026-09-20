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

/**
 * The sorted set of ICU arguments (`{name}`, including the leading argument of
 * a `plural` / `select` block) and markup tags (`<strong>`) a message uses,
 * rendered as a comparable string. Also kept inline per HON-669.
 */
function placeholders(message: unknown): string {
  if (typeof message !== 'string') return ''
  const found = new Set<string>()
  for (const match of message.matchAll(/\{\s*([a-zA-Z0-9_]+)\s*[,}]/g)) found.add(match[1]!)
  for (const match of message.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)>/g)) found.add(`<${match[1]!}>`)
  return [...found].sort().join(', ')
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

  it('en.json and et.json use the same ICU placeholders and markup tags', () => {
    // Key parity alone lets a translation silently drop an argument: an `et`
    // `emails.accountDeletionRequested.subject` without `{date}` still has the
    // key, still renders, and omits the purge date — a GDPR-relevant fact —
    // from the subject line (HON-513). Markup tags are checked too, since
    // `t.markup` callers pass a handler per tag.
    const en = catalogues['en.json']
    const et = catalogues['et.json']
    const drift: string[] = []

    for (const [key, value] of en) {
      if (!et.has(key)) continue // reported by the key-parity test above
      const enPlaceholders = placeholders(value)
      const etPlaceholders = placeholders(et.get(key))
      if (enPlaceholders !== etPlaceholders) {
        drift.push(`${key} — en: [${enPlaceholders}] et: [${etPlaceholders}]`)
      }
    }

    expect(drift, 'keys whose placeholders differ between en.json and et.json').toEqual([])
  })

  it.each(Object.entries(catalogues))('%s has no empty values', (file, messages) => {
    const empty = [...messages]
      .filter(([, value]) => typeof value === 'string' && value.trim() === '')
      .map(([key]) => key)

    expect(empty, `keys with an empty value in ${file}`).toEqual([])
  })
})
