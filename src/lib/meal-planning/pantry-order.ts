interface SortablePantryItem {
  isStaple: boolean
  ingredient: { name: string }
}

/**
 * The pantry's display order: staples first, then A–Z on the name the household
 * sees. `loadPantry` sorts with it after translating, and the client re-sorts
 * with it after an add or a purchase, so both agree.
 *
 * Collated in the household's locale: a bare `localeCompare` resolves the
 * runtime's default, which puts `õ` beside `o` and `š` beside `s` rather than
 * at the end of the Estonian alphabet (HON-920).
 */
export function comparePantryItems(
  locale: string,
): (a: SortablePantryItem, b: SortablePantryItem) => number {
  const collator = new Intl.Collator(locale)
  return (a, b) =>
    Number(b.isStaple) - Number(a.isStaple) ||
    collator.compare(a.ingredient.name, b.ingredient.name)
}
