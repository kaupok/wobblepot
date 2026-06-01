/**
 * Normalize an ingredient name into a stable lookup key for matching seeded
 * Estonian translations (`prisma/seed-ingredient-translations-et.ts`) against
 * the live global ingredient set.
 *
 * WHY: HON-507 keyed meal translations on the raw English name and silently
 * dropped two rows on an apostrophe/spacing mismatch ("Shepherd s Pie" vs
 * "Shepherd's Pie"). At ~1,102 ingredients that failure mode multiplies, so
 * both the seeder and the static seed-validator key on this normalized form:
 * lowercased, whitespace-collapsed, and with curly apostrophes folded to the
 * straight ASCII variant. Translation `en` values are copied verbatim from the
 * seed source, so this is a safety net rather than the primary guarantee — the
 * seeder still fails loudly if any global ingredient lacks a translation.
 */
export function normalizeIngredientKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[‘’]/g, "'") // ‘ ’ → '
    .replace(/\s+/g, ' ')
}
