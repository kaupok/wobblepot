import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}))

import { prisma } from '@/lib/prisma'

import { type MatchedIngredient, matchIngredients } from './match-ingredients'
import { makeDbMatch, makeExtracted } from './match-ingredients.fixtures'

const mockQueryRaw = vi.mocked(prisma.$queryRaw)

describe('matchIngredients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Estonian household (HON-912)', () => {
    const et = { householdId: 'hh-1', locale: 'et' }

    // Answers each fuzzy search by its search term, so a test does not depend on how
    // many candidate names (direct, alias, normalized) the matcher tries.
    const mockSearch = (rowsBySearchName: Record<string, ReturnType<typeof makeDbMatch>[]>) => {
      mockQueryRaw.mockImplementation(((_strings: TemplateStringsArray, searchName: string) =>
        Promise.resolve(rowsBySearchName[searchName] ?? [])) as never)
    }

    it('resolves "paprika" to bell pepper, not the spice', async () => {
      // Seed data: both score 1.0 — the spice by its English name, bell pepper by its
      // Estonian translation. The household's language wins the tie.
      mockSearch({
        paprika: [
          makeDbMatch({ id: 'ing-paprika', name: 'paprika', category: 'spice', similarity: 1 }),
          makeDbMatch({
            id: 'ing-bell-pepper',
            name: 'bell pepper',
            matchedName: 'paprika',
            category: 'vegetable',
            similarity: 1,
            source: 'translation',
          }),
        ],
      })

      const results = await matchIngredients([makeExtracted({ name: 'paprika' })], 4, et)

      const matched = results[0] as MatchedIngredient
      expect(matched.type).toBe('matched')
      expect(matched.ingredient.id).toBe('ing-bell-pepper')
      expect(matched.ingredient.name).toBe('bell pepper')
      expect(matched.matchedName).toBe('paprika')
    })

    it('prefers an exact translation over a weaker English hit', async () => {
      mockSearch({
        spinat: [
          makeDbMatch({ id: 'ing-spinach-en', name: 'spinach', similarity: 0.5 }),
          makeDbMatch({
            id: 'ing-spinach',
            name: 'spinach',
            matchedName: 'spinat',
            similarity: 1,
            source: 'translation',
          }),
        ],
      })

      const results = await matchIngredients([makeExtracted({ name: 'spinat' })], 4, et)

      const matched = results[0] as MatchedIngredient
      expect(matched.type).toBe('matched')
      expect(matched.ingredient.id).toBe('ing-spinach')
      expect(matched.similarityScore).toBe(1)
      expect(matched.lowConfidence).toBe(false)
    })

    it('does not flag a multi-word translation match whose words agree', async () => {
      mockSearch({
        'must pipar': [
          makeDbMatch({
            id: 'ing-black-pepper',
            name: 'black pepper',
            matchedName: 'must pipar',
            similarity: 1,
            source: 'translation',
          }),
        ],
      })

      const results = await matchIngredients([makeExtracted({ name: 'must pipar' })], 4, et)

      const matched = results[0] as MatchedIngredient
      expect(matched.ingredient.name).toBe('black pepper')
      expect(matched.lowConfidence).toBe(false)
      expect(matched.alternatives).toBeUndefined()
    })

    it('still flags a multi-word translation match whose primary words differ', async () => {
      mockSearch({
        'valge pipar': [
          makeDbMatch({
            id: 'ing-black-pepper',
            name: 'black pepper',
            matchedName: 'must pipar',
            similarity: 0.7,
            source: 'translation',
          }),
        ],
      })

      const results = await matchIngredients([makeExtracted({ name: 'valge pipar' })], 4, et)

      const matched = results[0] as MatchedIngredient
      expect(matched.type).toBe('matched')
      expect(matched.lowConfidence).toBe(true)
    })

    it('accepts a last-word fallback whose word is in the translation name', async () => {
      mockSearch({
        spinat: [
          makeDbMatch({
            id: 'ing-spinach',
            name: 'spinach',
            matchedName: 'spinat',
            similarity: 1,
            source: 'translation',
          }),
        ],
      })

      const results = await matchIngredients([makeExtracted({ name: 'värske spinat' })], 4, et)

      const matched = results[0] as MatchedIngredient
      expect(matched.type).toBe('matched')
      expect(matched.ingredient.id).toBe('ing-spinach')
      // "värske" is a prep word the normalizer drops, as it drops "fresh" (HON-1546)
      expect(matched.lowConfidence).toBe(false)
    })
  })
})
