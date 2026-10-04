/**
 * Seed meal names that differ only by case or punctuation (HON-1046).
 *
 * The global image batch (`scripts/generate-global-meal-images.ts`) keys meals
 * by the slug of their English name and skips every meal whose slug is shared,
 * so the beef and lamb shepherd's pies, whose names differed only by an
 * apostrophe, both went without an image. A reader sees such a pair as one
 * name with a typo, too.
 *
 * Kept apart from `seed-validator.ts`, which runs on import, so a test can
 * load it.
 */

/**
 * Same rule as `slugify` in `scripts/spike-meal-images.ts`, which the image
 * batch uses. Copied rather than imported because that module loads the AI
 * SDKs; `seed-meal-slugs.test.ts` fails if the two drift.
 */
export const mealSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** One error per slug that more than one distinct meal name maps to. */
export function checkMealSlugCollisions(meals: readonly { name: string }[]): string[] {
  const namesBySlug = new Map<string, Set<string>>()
  for (const { name } of meals) {
    const slug = mealSlug(name)
    const names = namesBySlug.get(slug) ?? new Set<string>()
    names.add(name)
    namesBySlug.set(slug, names)
  }

  const errors: string[] = []
  for (const [slug, names] of namesBySlug) {
    if (names.size > 1) {
      const quoted = [...names].map((n) => `'${n}'`).join(', ')
      errors.push(`Meal names share the slug '${slug}': ${quoted}`)
    }
  }
  return errors
}
