import { describe, it, expect } from 'vitest'
import {
  VAGUE_PHRASES,
  isVaguePhrase,
  extractVaguePhrase,
  getVagueCategory,
  getVagueDefault,
  checkGuardrail,
  formatVaguePhrase,
} from './vague-quantities'
import type { IngredientCategory } from '@/generated/prisma/enums'

describe('VAGUE_PHRASES', () => {
  it('includes common vague quantity phrases', () => {
    expect(VAGUE_PHRASES).toContain('to taste')
    expect(VAGUE_PHRASES).toContain('a pinch')
    expect(VAGUE_PHRASES).toContain('a drizzle')
    expect(VAGUE_PHRASES).toContain('for garnish')
    expect(VAGUE_PHRASES).toContain('optional')
    expect(VAGUE_PHRASES).toContain('as needed')
  })
})

describe('isVaguePhrase', () => {
  it('returns true for exact vague phrases', () => {
    expect(isVaguePhrase('to taste')).toBe(true)
    expect(isVaguePhrase('a pinch')).toBe(true)
    expect(isVaguePhrase('for garnish')).toBe(true)
  })

  it('returns true for phrases containing vague words', () => {
    expect(isVaguePhrase('salt to taste')).toBe(true)
    expect(isVaguePhrase('add a pinch of salt')).toBe(true)
  })

  it('is case insensitive', () => {
    expect(isVaguePhrase('TO TASTE')).toBe(true)
    expect(isVaguePhrase('A Pinch')).toBe(true)
  })

  it('returns false for non-vague phrases', () => {
    expect(isVaguePhrase('1 teaspoon')).toBe(false)
    expect(isVaguePhrase('200g')).toBe(false)
    expect(isVaguePhrase('2 cups')).toBe(false)
  })
})

describe('extractVaguePhrase', () => {
  it('extracts exact vague phrases', () => {
    expect(extractVaguePhrase('to taste')).toBe('to taste')
    expect(extractVaguePhrase('a pinch')).toBe('a pinch')
  })

  it('extracts vague phrases from longer text', () => {
    expect(extractVaguePhrase('salt to taste')).toBe('to taste')
    expect(extractVaguePhrase('add a pinch of pepper')).toBe('a pinch')
  })

  it('returns null for non-vague phrases', () => {
    expect(extractVaguePhrase('1 teaspoon')).toBeNull()
    expect(extractVaguePhrase('200 grams')).toBeNull()
  })
})

describe('getVagueCategory', () => {
  it('returns mineral for salt subcategory', () => {
    expect(getVagueCategory('spice' as IngredientCategory, 'mineral')).toBe('mineral')
    expect(getVagueCategory('spice' as IngredientCategory, 'salt')).toBe('mineral')
  })

  it('returns herb_fresh for fresh herbs', () => {
    expect(getVagueCategory('spice' as IngredientCategory, 'herb')).toBe('herb_fresh')
    expect(getVagueCategory('spice' as IngredientCategory, 'herb (fresh)')).toBe('herb_fresh')
  })

  it('returns herb_dried for dried herbs', () => {
    expect(getVagueCategory('spice' as IngredientCategory, 'herb', true)).toBe('herb_dried')
    expect(getVagueCategory('spice' as IngredientCategory, 'herb (dried)')).toBe('herb_dried')
  })

  it('returns oil for fat category', () => {
    expect(getVagueCategory('fat' as IngredientCategory, null)).toBe('oil')
  })

  it('returns condiment for condiment category', () => {
    expect(getVagueCategory('condiment' as IngredientCategory, null)).toBe('condiment')
  })

  it('returns default for unknown categories', () => {
    expect(getVagueCategory('vegetable' as IngredientCategory, null)).toBe('default')
    expect(getVagueCategory('protein' as IngredientCategory, null)).toBe('default')
  })
})

describe('getVagueDefault', () => {
  describe('mineral (salt)', () => {
    it('returns 1g for to taste', () => {
      const result = getVagueDefault('spice' as IngredientCategory, 'mineral', 'to taste')
      expect(result).toEqual({
        quantity: 1,
        isVague: true,
        originalPhrase: 'to taste',
      })
    })

    it('returns 1g for a pinch', () => {
      const result = getVagueDefault('spice' as IngredientCategory, 'salt', 'a pinch')
      expect(result).toEqual({
        quantity: 1,
        isVague: true,
        originalPhrase: 'a pinch',
      })
    })
  })

  describe('spice', () => {
    it('returns 0.5g for to taste', () => {
      const result = getVagueDefault('spice' as IngredientCategory, null, 'to taste')
      expect(result).toEqual({
        quantity: 0.5,
        isVague: true,
        originalPhrase: 'to taste',
      })
    })

    it('returns 2g for a handful', () => {
      const result = getVagueDefault('spice' as IngredientCategory, null, 'a handful')
      expect(result).toEqual({
        quantity: 2,
        isVague: true,
        originalPhrase: 'a handful',
      })
    })
  })

  describe('oil', () => {
    it('returns 10g for a drizzle', () => {
      const result = getVagueDefault('fat' as IngredientCategory, null, 'a drizzle')
      expect(result).toEqual({
        quantity: 10,
        isVague: true,
        originalPhrase: 'a drizzle',
      })
    })

    it('returns 10g for splash', () => {
      const result = getVagueDefault('fat' as IngredientCategory, 'oil', 'splash')
      expect(result).toEqual({
        quantity: 10,
        isVague: true,
        originalPhrase: 'splash',
      })
    })
  })

  describe('fresh herbs', () => {
    it('returns 5g for garnish', () => {
      const result = getVagueDefault('spice' as IngredientCategory, 'herb', 'for garnish')
      expect(result).toEqual({
        quantity: 5,
        isVague: true,
        originalPhrase: 'for garnish',
      })
    })

    it('returns 10g for a handful', () => {
      const result = getVagueDefault('spice' as IngredientCategory, 'herb (fresh)', 'a handful')
      expect(result).toEqual({
        quantity: 10,
        isVague: true,
        originalPhrase: 'a handful',
      })
    })
  })

  it('uses default fallback for unknown phrase groups', () => {
    // This should return null since it's not a valid phrase
    const result = getVagueDefault('protein' as IngredientCategory, null, 'unknown phrase')
    expect(result).toBeNull()
  })

  it('uses default category fallback for impossible combinations', () => {
    // "handful of salt" doesn't make sense, but we provide a fallback
    const result = getVagueDefault('spice' as IngredientCategory, 'mineral', 'a handful')
    expect(result).toEqual({
      quantity: 10, // default fallback
      isVague: true,
      originalPhrase: 'a handful',
    })
  })
})

describe('checkGuardrail', () => {
  it('returns undefined for reasonable salt quantities', () => {
    expect(checkGuardrail(1, 'spice' as IngredientCategory, 'mineral')).toBeUndefined()
    expect(checkGuardrail(2, 'spice' as IngredientCategory, 'salt')).toBeUndefined()
  })

  it('returns warning for excessive salt quantities', () => {
    const result = checkGuardrail(5, 'spice' as IngredientCategory, 'mineral')
    expect(result).toContain('Unusually high')
    expect(result).toContain('5g per serving')
    expect(result).toContain('exceeds typical 3g max')
  })

  it('returns undefined for reasonable spice quantities', () => {
    expect(checkGuardrail(1, 'spice' as IngredientCategory, null)).toBeUndefined()
  })

  it('returns warning for excessive spice quantities', () => {
    const result = checkGuardrail(10, 'spice' as IngredientCategory, null)
    expect(result).toContain('Unusually high')
    expect(result).toContain('exceeds typical 2g max')
  })

  it('returns undefined for categories without thresholds', () => {
    expect(checkGuardrail(100, 'protein' as IngredientCategory, null)).toBeUndefined()
    expect(checkGuardrail(500, 'vegetable' as IngredientCategory, null)).toBeUndefined()
  })
})

describe('formatVaguePhrase', () => {
  it('formats to taste correctly', () => {
    expect(formatVaguePhrase('to taste')).toBe('to taste')
    expect(formatVaguePhrase('TO TASTE')).toBe('to taste')
  })

  it('formats for garnish correctly', () => {
    expect(formatVaguePhrase('for garnish')).toBe('for garnish')
    expect(formatVaguePhrase('garnish')).toBe('for garnish')
    expect(formatVaguePhrase('GARNISH')).toBe('for garnish')
  })

  it('formats optional correctly', () => {
    expect(formatVaguePhrase('optional')).toBe('optional')
    expect(formatVaguePhrase('OPTIONAL')).toBe('optional')
  })

  it('normalizes other phrases to lowercase', () => {
    expect(formatVaguePhrase('A PINCH')).toBe('a pinch')
    expect(formatVaguePhrase('A Drizzle')).toBe('a drizzle')
  })
})
