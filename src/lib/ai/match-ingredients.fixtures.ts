import type { ExtractedIngredient } from './recipe-schema'

// Shared by the matcher's unit and PGlite tests, which are split by topic for the file-size cap

/** A recipe line as the parser returns it, for the mocked unit tests */
export const makeExtracted = (
  overrides: Partial<ExtractedIngredient> = {},
): ExtractedIngredient => ({
  name: 'chicken breast',
  quantity: 500,
  unit: 'g',
  originalText: '500g chicken breast',
  isVague: false,
  vaguePhrase: null,
  isDried: null,
  ...overrides,
})

/** A fuzzy-search row as `$queryRaw` returns it, for the mocked unit tests */
export const makeDbMatch = (overrides: Record<string, unknown> = {}) => ({
  id: 'ing-1',
  name: 'chicken breast',
  category: 'protein' as const,
  subcategory: null,
  defaultUnit: 'g' as const,
  measuredByVolume: false,
  gramsPerPiece: null,
  similarity: 0.9,
  source: 'global' as const,
  ...overrides,
  // The name the match was made on; defaults to the canonical name, as for a global row.
  matchedName: overrides.matchedName ?? overrides.name ?? 'chicken breast',
})

/** One piece of a named food, for the PGlite tests */
export function extracted(name: string): ExtractedIngredient {
  return {
    name,
    quantity: 1,
    unit: 'piece',
    originalText: `1 ${name}`,
    isVague: false,
    vaguePhrase: null,
    isDried: null,
  }
}
