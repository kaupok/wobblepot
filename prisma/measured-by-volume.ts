// Which global ingredients a cook measures by volume (a jug or a spoon) rather
// than by weight (HON-1069). The seed sets `Ingredient.measuredByVolume` from
// this rule. Migration 20261006130000_add_ingredient_measured_by_volume repeats
// the three lists by hand, because a migration cannot import TypeScript;
// measured-by-volume.test.ts fails when the two copies differ.
//
// Names and subcategories match exactly, case-sensitive, as the seeds spell them.

/** Subcategories whose ingredients are all pourable, except the excluded names. */
export const MEASURED_BY_VOLUME_SUBCATEGORIES: ReadonlySet<string> = new Set([
  'liquid',
  'oil',
  'infused oil',
  'vinegar',
  'cooking wine',
  'spirit',
  'milk',
  'milk alternative',
  'broth',
  'citrus juice',
  'extract',
])

/**
 * Pourable ingredients outside those subcategories: in mixed ones (`cream`
 * holds clotted cream, `sauce` holds pesto and mayonnaise), in `acid` (the
 * vinegars), or with no subcategory at all.
 */
export const MEASURED_BY_VOLUME_NAMES: ReadonlySet<string> = new Set([
  'heavy cream',
  'double cream',
  'whipping cream',
  'soy sauce',
  'light soy sauce',
  'dark soy sauce',
  'sweet soy sauce',
  'tamari',
  'fish sauce',
  'fish sauce thai',
  'ponzu',
  'mentsuyu',
  'worcestershire sauce',
  'hot sauce',
  'teriyaki sauce',
  'coconut aminos',
  'tucupi',
  'vinegar',
  'balsamic vinegar',
  'canola oil',
  'half and half',
])

/** Solid or spoonable ingredients in a pourable subcategory. Wins over both lists above. */
export const NOT_MEASURED_BY_VOLUME_NAMES: ReadonlySet<string> = new Set([
  'coconut oil',
  'palm oil',
  'condensed milk',
  'guarana',
])

export function isMeasuredByVolume({
  name,
  subcategory,
}: {
  name: string
  subcategory?: string | null
}): boolean {
  if (NOT_MEASURED_BY_VOLUME_NAMES.has(name)) return false
  if (MEASURED_BY_VOLUME_NAMES.has(name)) return true
  return subcategory != null && MEASURED_BY_VOLUME_SUBCATEGORIES.has(subcategory)
}
