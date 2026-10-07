/**
 * Reference checks for the alias and synonym tables in
 * `src/lib/ingredient-aliases.ts`, run by `pnpm db:validate`.
 *
 * Kept out of `seed-validator.ts` because that script runs `main()` on import,
 * so a test cannot load it.
 */

import { synonymKey } from '../src/lib/ingredient-aliases'

type ValidationResult = {
  errors: string[]
  warnings: string[]
}

export function validateIngredientAliases(
  ingredientNames: Set<string>,
  aliases: Record<string, string>,
  synonyms: Record<string, string>,
): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  for (const [from, to] of Object.entries(aliases)) {
    if (!ingredientNames.has(to)) {
      errors.push(
        `Ingredient alias "${from}" → "${to}" points to non-existent ingredient. ` +
          `Either add "${to}" to seed data or remove this alias.`,
      )
    }
  }

  // Synonyms are looked up by `synonymKey`, so compare by it too: a key that
  // only differs from a pool name by a hyphen would map that name away.
  const poolByKey = new Map([...ingredientNames].map((name) => [synonymKey(name), name]))
  const synonymByKey = new Map<string, string>()

  for (const [from, to] of Object.entries(synonyms)) {
    if (!ingredientNames.has(to)) {
      errors.push(
        `Ingredient synonym "${from}" → "${to}" points to non-existent ingredient. ` +
          `Either add "${to}" to seed data or remove this synonym.`,
      )
    }
    // The search route would offer the row twice: once by its own name, once
    // as the other row's synonym.
    if (ingredientNames.has(from)) {
      errors.push(
        `Ingredient synonym "${from}" is itself an ingredient name. ` +
          `Remove the synonym, or merge the two rows.`,
      )
    }
    const key = synonymKey(from)
    const poolName = poolByKey.get(key)
    if (poolName !== undefined && poolName !== from) {
      errors.push(
        `Ingredient synonym "${from}" reads as the ingredient name "${poolName}". ` +
          `Remove the synonym, or merge the two rows.`,
      )
    }
    const twin = synonymByKey.get(key)
    if (twin !== undefined) {
      errors.push(`Ingredient synonyms "${twin}" and "${from}" read as one key. Keep one.`)
    }
    synonymByKey.set(key, from)
    if (from in aliases) {
      errors.push(`"${from}" is both an ingredient alias and a synonym. Keep it in one table.`)
    }
  }

  return { errors, warnings }
}
