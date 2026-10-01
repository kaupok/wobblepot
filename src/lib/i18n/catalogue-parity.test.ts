import { describe, it, expect } from 'vitest'
import {
  parse,
  TYPE,
  type MessageFormatElement,
  type PluralElement,
} from '@formatjs/icu-messageformat-parser'
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
 *
 * The negative lookbehind skips plural/select *option bodies*, which have the
 * same `{word}` shape as an argument: without it `{count, plural, one {Day}
 * other {Days}}` reads as three arguments, while its Estonian counterpart
 * `one {Päev}` reads as one (the ASCII character class stops at `P`) — so two
 * correct translations would be reported as drift.
 */
function placeholders(message: unknown): string {
  if (typeof message !== 'string') return ''
  const found = new Set<string>()
  const argument = /(?<!(?:=\d+|zero|one|two|few|many|other)\s)\{\s*([a-zA-Z0-9_]+)\s*[,}]/g
  for (const match of message.matchAll(argument)) found.add(match[1]!)
  for (const match of message.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)>/g)) found.add(`<${match[1]!}>`)
  return [...found].sort().join(', ')
}

/** ICU argument kinds the shape check compares. A plain `{name}` is `argument`. */
type ArgumentKind = 'argument' | 'number' | 'date' | 'time' | 'select' | 'plural' | 'selectordinal'

const KIND: Partial<Record<TYPE, ArgumentKind>> = {
  [TYPE.argument]: 'argument',
  [TYPE.number]: 'number',
  [TYPE.date]: 'date',
  [TYPE.time]: 'time',
  [TYPE.select]: 'select',
}

const BRANCHING: ReadonlySet<ArgumentKind> = new Set(['plural', 'select', 'selectordinal'])

/**
 * Every ICU argument in a parsed message, nested ones included, mapped to its
 * kind. An argument used twice with different kinds keeps the branching one
 * (`plural` / `select`), since that is the one a translation must not lose.
 * Also kept inline per HON-669.
 */
function argumentKinds(
  elements: MessageFormatElement[],
  out = new Map<string, ArgumentKind>(),
): Map<string, ArgumentKind> {
  for (const element of elements) {
    let kind: ArgumentKind | undefined = KIND[element.type]
    if (element.type === TYPE.plural) {
      kind = element.pluralType === 'ordinal' ? 'selectordinal' : 'plural'
    }
    if (kind && 'value' in element && typeof element.value === 'string') {
      const previous = out.get(element.value)
      if (!previous || (BRANCHING.has(kind) && !BRANCHING.has(previous))) {
        out.set(element.value, kind)
      }
    }
    if (element.type === TYPE.plural || element.type === TYPE.select) {
      for (const option of Object.values(element.options)) argumentKinds(option.value, out)
    }
    if (element.type === TYPE.tag) argumentKinds(element.children, out)
  }
  return out
}

/** Every cardinal `plural` block in a parsed message, nested ones included. */
function cardinalPlurals(elements: MessageFormatElement[], out: PluralElement[] = []) {
  for (const element of elements) {
    if (element.type === TYPE.plural && element.pluralType === 'cardinal') out.push(element)
    if (element.type === TYPE.plural || element.type === TYPE.select) {
      for (const option of Object.values(element.options)) cardinalPlurals(option.value, out)
    }
    if (element.type === TYPE.tag) cardinalPlurals(element.children, out)
  }
  return out
}

/** Estonian's CLDR cardinal categories; `other` alone would render "1 portsjonit". */
const ET_PLURAL_CATEGORIES = ['one', 'other'] as const

/**
 * What is wrong with the shape of an `en` / `et` message pair, as readable
 * lines. Empty means the pair is consistent.
 *
 * - An argument `en` branches on (`plural`, `select`, `selectordinal`) must
 *   branch the same way in `et`. An `et` message that drops the `plural` block
 *   but keeps `{count}` passes the placeholder check above and renders one
 *   form for every count.
 * - The reverse is allowed: Estonian inflects nouns English leaves alone, so
 *   `"Serves {count}"` is correctly `"{count, plural, one {# portsjon} other
 *   {# portsjonit}}"` (`meal-plan.serving.labelWithCount`).
 * - Every cardinal `plural` in `et` carries both `one` and `other`.
 */
function shapeProblems(en: string, et: string): string[] {
  const problems: string[] = []
  const etParsed = parse(et)
  const etKinds = argumentKinds(etParsed)

  for (const [name, kind] of argumentKinds(parse(en))) {
    if (!BRANCHING.has(kind)) continue
    const etKind = etKinds.get(name)
    if (etKind !== kind) problems.push(`{${name}} is ${kind} in en but ${etKind ?? 'absent'} in et`)
  }

  for (const plural of cardinalPlurals(etParsed)) {
    const missing = ET_PLURAL_CATEGORIES.filter((category) => !(category in plural.options))
    if (missing.length > 0) {
      problems.push(`et plural {${plural.value}} is missing ${missing.join(', ')}`)
    }
  }

  return problems
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

  it.each([
    ['{appName} account will be deleted on {date}', 'appName, date'],
    ['Deleted on <strong>{date}</strong>', '<strong>, date'],
    // Plural option bodies are not arguments — `one {Day}` must not read as one.
    ['{count, plural, one {Day} other {Days}}', 'count'],
    ['{count, plural, one {Päev} other {Päeva}}', 'count'],
    ['{count, plural, =0 {None} other {# rows}}', 'count'],
    // A genuine argument nested inside an option body still counts.
    ['{count, plural, one {# of {rows}} other {# of {rows}}}', 'count, rows'],
  ])('reads %s as [%s]', (message, expected) => {
    expect(placeholders(message)).toBe(expected)
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

  it.each(Object.entries(catalogues))('every message in %s parses as ICU', (file, messages) => {
    // A message next-intl cannot parse renders as its key path (`shopping.itemCount`)
    // at runtime, and nothing else reports it.
    const broken: string[] = []
    for (const [key, value] of messages) {
      if (typeof value !== 'string') continue
      try {
        parse(value)
      } catch (error) {
        broken.push(`${key} — ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    expect(broken, `messages in ${file} that do not parse`).toEqual([])
  })

  it.each([
    ['dropped plural block', '{count, plural, one {# item} other {# items}}', '{count} asja', 1],
    [
      'plural turned into select',
      '{count, plural, one {# item} other {# items}}',
      '{count, select, other {# asja}}',
      1,
    ],
    ['dropped select', '{kind, select, a {A} other {B}}', '{kind}', 1],
    [
      'dropped plural after a number use',
      '{n, number} {n, plural, one {item} other {items}}',
      '{n, number} asja',
      1,
    ],
    ['et plural without one', '{n, plural, other {# items}}', '{n, plural, other {# asja}}', 1],
    [
      'nested plural without one',
      '{kind, select, a {{n, plural, one {#} other {#}}} other {x}}',
      '{kind, select, a {{n, plural, other {#}}} other {x}}',
      1,
    ],
    [
      'matching plurals',
      '{n, plural, one {# item} other {# items}}',
      '{n, plural, one {# asi} other {# asja}}',
      0,
    ],
    [
      'et adds a plural en does not need',
      'Serves {count}',
      '{count, plural, one {# portsjon} other {# portsjonit}}',
      0,
    ],
  ])('shape check: %s → %i problem(s)', (_label, en, et, expected) => {
    expect(shapeProblems(en, et)).toHaveLength(expected)
  })

  it('a malformed message fails to parse', () => {
    expect(() => parse('{count, plural, one {# item}}')).toThrow()
    expect(() => parse('{count, plural, one {# item} other {# items}')).toThrow()
  })

  it('en.json and et.json agree on plural and select shape', () => {
    const en = catalogues['en.json']
    const et = catalogues['et.json']
    const drift: string[] = []

    for (const [key, value] of en) {
      const etValue = et.get(key)
      // Missing keys and unparseable messages are reported by the tests above.
      if (typeof value !== 'string' || typeof etValue !== 'string') continue
      let problems: string[]
      try {
        problems = shapeProblems(value, etValue)
      } catch {
        continue
      }
      for (const problem of problems) drift.push(`${key} — ${problem}`)
    }

    expect(drift, 'keys whose plural/select shape differs between en.json and et.json').toEqual([])
  })

  it.each(Object.entries(catalogues))('%s has no empty values', (file, messages) => {
    const empty = [...messages]
      .filter(([, value]) => typeof value === 'string' && value.trim() === '')
      .map(([key]) => key)

    expect(empty, `keys with an empty value in ${file}`).toEqual([])
  })
})
