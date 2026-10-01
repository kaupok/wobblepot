import { describe, it, expect } from 'vitest'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { VAGUE_PHRASES } from '@/lib/vague-quantities'
import {
  VAGUE_PHRASE_KEYS,
  formatVaguePhrase,
  vaguePhraseKey,
  type VaguePhraseKey,
} from './vague-phrase'

const catalogs = { en: enMessages.enums.VaguePhrase, et: etMessages.enums.VaguePhrase }
const label = (locale: 'en' | 'et') => (key: VaguePhraseKey) => catalogs[locale][key]

describe('vaguePhraseKey', () => {
  it('maps every phrase in the vocabulary to a key', () => {
    for (const phrase of VAGUE_PHRASES) {
      expect(vaguePhraseKey(phrase)).toBe(VAGUE_PHRASE_KEYS[phrase])
    }
  })

  it('collapses article variants onto one key', () => {
    expect(vaguePhraseKey('a pinch')).toBe('pinch')
    expect(vaguePhraseKey('pinch')).toBe('pinch')
    expect(vaguePhraseKey('for garnish')).toBe('forGarnish')
    expect(vaguePhraseKey('garnish')).toBe('forGarnish')
  })

  it('ignores case and surrounding or repeated whitespace', () => {
    expect(vaguePhraseKey('  To Taste ')).toBe('toTaste')
    expect(vaguePhraseKey('A  PINCH')).toBe('pinch')
  })

  it('returns null for a phrase outside the vocabulary', () => {
    expect(vaguePhraseKey('maitse järgi')).toBeNull()
    expect(vaguePhraseKey('a smidgen')).toBeNull()
    expect(vaguePhraseKey('')).toBeNull()
  })
})

describe('enums.VaguePhrase catalog', () => {
  it.each(['en', 'et'] as const)('has a non-empty %s label for every key', (locale) => {
    for (const key of new Set(Object.values(VAGUE_PHRASE_KEYS))) {
      expect(catalogs[locale][key]).toBeTruthy()
    }
  })
})

describe('formatVaguePhrase', () => {
  it('renders a known phrase in the locale (HON-917)', () => {
    expect(formatVaguePhrase('to taste', label('et'))).toBe('maitse järgi')
    expect(formatVaguePhrase('to taste', label('en'))).toBe('to taste')
    expect(formatVaguePhrase('pinch', label('en'))).toBe('a pinch')
  })

  it('renders a phrase outside the vocabulary verbatim', () => {
    expect(formatVaguePhrase('maitse järgi', label('et'))).toBe('maitse järgi')
    expect(formatVaguePhrase('A Smidgen', label('en'))).toBe('A Smidgen')
  })
})
