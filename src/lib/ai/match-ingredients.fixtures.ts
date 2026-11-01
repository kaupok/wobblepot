import type { ExtractedIngredient } from './recipe-schema'

// The recipe line the `match-ingredients` db tests match, built from a name alone.

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
