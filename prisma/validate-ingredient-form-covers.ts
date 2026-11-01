/**
 * Reference check for the herb cover table in
 * `src/lib/ingredient-form-covers.ts`, run by `pnpm db:validate`.
 *
 * Kept out of `seed-validator.ts` because that script runs `main()` on import,
 * so a test cannot load it.
 */

export function validateIngredientFormCovers(
  ingredientNames: Set<string>,
  covers: Readonly<Record<string, string>>,
): string[] {
  const errors: string[] = []
  for (const [form, bare] of Object.entries(covers)) {
    for (const name of [form, bare]) {
      if (!ingredientNames.has(name)) {
        errors.push(
          `Ingredient form cover "${form}" → "${bare}" names non-existent ingredient "${name}". ` +
            `Either add "${name}" to seed data or remove this cover.`,
        )
      }
    }
  }
  return errors
}
