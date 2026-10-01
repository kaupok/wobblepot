import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}))

import { prisma } from '@/lib/prisma'
import {
  fuzzySearchIngredient,
  rankFuzzyMatches,
  type FuzzyIngredientMatch,
} from './fuzzy-ingredient-match'

const mockQueryRaw = vi.mocked(prisma.$queryRaw)

describe('fuzzySearchIngredient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls prisma.$queryRaw with the search name', async () => {
    mockQueryRaw.mockResolvedValue([])
    await fuzzySearchIngredient('chicken breast')
    expect(mockQueryRaw).toHaveBeenCalledTimes(1)
  })

  it('returns results from the database', async () => {
    const mockResults = [
      {
        id: 'ing-1',
        name: 'chicken breast',
        category: 'protein',
        subcategory: null,
        defaultUnit: 'g',
        gramsPerPiece: null,
        similarity: 0.9,
        source: 'global',
        matchedName: 'chicken breast',
      },
    ]
    mockQueryRaw.mockResolvedValue(mockResults)

    const results = await fuzzySearchIngredient('chicken breast')
    expect(results).toEqual(mockResults)
  })

  it('accepts optional householdId and locale without throwing', async () => {
    mockQueryRaw.mockResolvedValue([])
    await fuzzySearchIngredient('sibul', { householdId: 'hh-1', locale: 'et' })
    expect(mockQueryRaw).toHaveBeenCalledTimes(1)
  })

  it('returns the top result regardless of source — caller does not branch on source', async () => {
    // The matcher takes the first row; this verifies it does not require `source` to be 'global'.
    const mockResults = [
      {
        id: 'ing-translation',
        name: 'onion',
        category: 'vegetable',
        subcategory: null,
        defaultUnit: 'piece',
        gramsPerPiece: 110,
        calories: 40,
        protein: 1.1,
        carbs: 9.3,
        fat: 0.1,
        similarity: 0.95,
        source: 'translation',
        matchedName: 'sibul',
      },
    ]
    mockQueryRaw.mockResolvedValue(mockResults)

    const results = await fuzzySearchIngredient('sibul', { locale: 'et' })
    expect(results[0]?.id).toBe('ing-translation')
    expect(results[0]?.name).toBe('onion')
  })

  it('orders candidates by similarity in SQL, with no source priority ahead of it', async () => {
    mockQueryRaw.mockResolvedValue([])
    await fuzzySearchIngredient('paprika', { locale: 'et' })

    const [strings] = mockQueryRaw.mock.calls[0] as unknown as [TemplateStringsArray]
    const sql = strings.join('?')
    expect(sql).toMatch(/ORDER BY similarity DESC\s+LIMIT/)
    expect(sql).not.toContain('source_priority')
    expect(sql).toContain('t.name AS "matchedName"')
  })

  it('returns an exact Estonian translation ahead of a weaker English hit', async () => {
    // SQL order is by similarity, but the ranking must hold however rows arrive.
    mockQueryRaw.mockResolvedValue([
      makeRow({ id: 'ing-spice', name: 'coriander seeds', similarity: 0.5 }),
      makeRow({
        id: 'ing-cilantro',
        name: 'cilantro',
        matchedName: 'koriander',
        similarity: 1,
        source: 'translation',
      }),
    ])

    const results = await fuzzySearchIngredient('koriander', { locale: 'et' })
    expect(results.map((r) => r.id)).toEqual(['ing-cilantro', 'ing-spice'])
    expect(results[0]?.name).toBe('cilantro')
    expect(results[0]?.matchedName).toBe('koriander')
  })
})

const makeRow = (overrides: Partial<FuzzyIngredientMatch> = {}): FuzzyIngredientMatch => ({
  id: 'ing-1',
  name: 'chicken breast',
  category: 'protein',
  subcategory: null,
  defaultUnit: 'g',
  gramsPerPiece: null,
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  similarity: 0.9,
  source: 'global',
  ...overrides,
  matchedName: overrides.matchedName ?? overrides.name ?? 'chicken breast',
})

describe('rankFuzzyMatches', () => {
  it('ranks by similarity before source', () => {
    const ranked = rankFuzzyMatches(
      [
        makeRow({ id: 'en', name: 'tomato paste', similarity: 0.5 }),
        makeRow({
          id: 'et',
          name: 'tomato sauce',
          matchedName: 'tomatikaste',
          similarity: 1,
          source: 'translation',
        }),
      ],
      'et',
    )
    expect(ranked.map((r) => r.id)).toEqual(['et', 'en'])
  })

  it('resolves Estonian "paprika" to bell pepper, not the spice, at an exact tie', () => {
    // Seed data: the spice's English name is "paprika" (its Estonian name is
    // "paprikapulber"), and bell pepper's Estonian name is "paprika". Both score 1.0.
    const ranked = rankFuzzyMatches(
      [
        makeRow({ id: 'ing-paprika-spice', name: 'paprika', similarity: 1, source: 'global' }),
        makeRow({
          id: 'ing-bell-pepper',
          name: 'bell pepper',
          matchedName: 'paprika',
          similarity: 1,
          source: 'translation',
        }),
      ],
      'et',
    )
    expect(ranked[0]?.id).toBe('ing-bell-pepper')
    expect(ranked[0]?.name).toBe('bell pepper')
  })

  it('prefers translation, then household, then global at equal similarity in a non-default locale', () => {
    const ranked = rankFuzzyMatches(
      [
        makeRow({ id: 'g', similarity: 0.8, source: 'global' }),
        makeRow({ id: 'h', similarity: 0.8, source: 'household' }),
        makeRow({ id: 't', similarity: 0.8, source: 'translation' }),
      ],
      'et',
    )
    expect(ranked.map((r) => r.id)).toEqual(['t', 'h', 'g'])
  })

  it('prefers global over household at equal similarity in the default locale', () => {
    const ranked = rankFuzzyMatches([
      makeRow({ id: 'h', similarity: 0.8, source: 'household' }),
      makeRow({ id: 'g', similarity: 0.8, source: 'global' }),
    ])
    expect(ranked.map((r) => r.id)).toEqual(['g', 'h'])
  })

  it('keeps one row per ingredient, the best-ranked one', () => {
    // "tomat" hits tomato both through its English name and its translation.
    const ranked = rankFuzzyMatches(
      [
        makeRow({ id: 'ing-tomato', name: 'tomato', similarity: 0.6, source: 'global' }),
        makeRow({
          id: 'ing-tomato',
          name: 'tomato',
          matchedName: 'tomat',
          similarity: 1,
          source: 'translation',
        }),
      ],
      'et',
    )
    expect(ranked).toHaveLength(1)
    expect(ranked[0]?.matchedName).toBe('tomat')
    expect(ranked[0]?.similarity).toBe(1)
  })

  it('returns at most four rows', () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      makeRow({ id: `ing-${i}`, similarity: 0.5 + i / 100 }),
    )
    const ranked = rankFuzzyMatches(rows)
    expect(ranked.map((r) => r.id)).toEqual(['ing-7', 'ing-6', 'ing-5', 'ing-4'])
  })
})
