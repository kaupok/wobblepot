import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { synonymKey } from './ingredient-aliases'
import { SHOP_INGREDIENT_SYNONYMS } from './ingredient-shop-synonyms'

const KEY_LINE = /^\s+(?:'([^']+)'|"([^"]+)"|([\p{L}_$][\p{L}\p{N}_$]*))\s*:/u

/**
 * The keys written in the `INGREDIENT_SYNONYMS` literal itself, without the
 * spread. The merged object cannot show a key the spread overrode, so the
 * source text is the only place a repeat is visible (HON-1557).
 */
function ownSynonymKeys(): { keys: string[]; unparsed: string[] } {
  const source = readFileSync(join(process.cwd(), 'src/lib/ingredient-aliases.ts'), 'utf8')
  const lines = source.split('\n')
  const start = lines.findIndex((line) => line.startsWith('export const INGREDIENT_SYNONYMS'))
  const end = lines.findIndex((line, index) => index > start && line === '}')
  const keys: string[] = []
  const unparsed: string[] = []
  for (const line of lines.slice(start + 1, end)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('...')) continue
    const match = KEY_LINE.exec(line)
    const key = match?.[1] ?? match?.[2] ?? match?.[3]
    if (key) keys.push(key)
    else unparsed.push(trimmed)
  }
  return { keys, unparsed }
}

describe('SHOP_INGREDIENT_SYNONYMS', () => {
  it('reads every own key of the INGREDIENT_SYNONYMS literal', () => {
    const { keys, unparsed } = ownSynonymKeys()

    expect(unparsed).toEqual([])
    expect(keys).toEqual(expect.arrayContaining(['all-purpose flour', 'cornstarch', 'chèvre']))
  })

  it('repeats no key of INGREDIENT_SYNONYMS, which the spread would drop silently', () => {
    const ownKeys = new Set(ownSynonymKeys().keys.map(synonymKey))
    const repeated = Object.keys(SHOP_INGREDIENT_SYNONYMS)
      .filter((key) => ownKeys.has(synonymKey(key)))
      .sort()

    expect(
      repeated,
      `Keys in both SHOP_INGREDIENT_SYNONYMS and INGREDIENT_SYNONYMS: ${repeated.join(', ')}`,
    ).toEqual([])
  })
})
