/**
 * Reference checks for the group table in
 * `src/lib/household/ingredient-groups.ts`, run by `pnpm db:validate`.
 *
 * Kept out of `seed-validator.ts` because that script runs `main()` on import,
 * so a test cannot load it.
 */

import type { IngredientGroup } from '../src/lib/household/ingredient-groups'

type ValidationResult = {
  errors: string[]
  warnings: string[]
}

export function validateIngredientGroups(
  ingredientNames: Set<string>,
  groups: readonly IngredientGroup[],
): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const groupOfWord = new Map<string, string>()

  for (const group of groups) {
    const label = group.en[0] ?? group.et[0] ?? '(no word)'
    for (const member of group.members) {
      if (!ingredientNames.has(member)) {
        errors.push(
          `Ingredient group "${label}" lists "${member}", which is not an ingredient name. ` +
            `Fix the name or remove the member.`,
        )
      }
    }
    for (const word of [...group.en, ...group.et]) {
      if (word !== word.toLowerCase()) {
        errors.push(`Ingredient group word "${word}" is not lower case.`)
      }
      const twin = groupOfWord.get(word.toLowerCase())
      if (twin !== undefined) {
        errors.push(
          `Ingredient group word "${word}" is in the groups "${twin}" and "${label}". Keep it in one.`,
        )
      }
      groupOfWord.set(word.toLowerCase(), label)
    }
  }

  return { errors, warnings }
}
