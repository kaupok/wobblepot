/**
 * Reference checks for the alias and synonym tables in
 * `src/lib/ingredient-aliases.ts`, run by `pnpm db:validate`.
 *
 * Kept out of `seed-validator.ts` because that script runs `main()` on import,
 * so a test cannot load it.
 */

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
    if (from in aliases) {
      errors.push(`"${from}" is both an ingredient alias and a synonym. Keep it in one table.`)
    }
  }

  return { errors, warnings }
}
