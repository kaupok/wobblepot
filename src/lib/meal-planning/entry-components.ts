/**
 * The merge rule for a planned entry's own ingredient changes (HON-1243). A
 * change row (`MealPlanEntryComponent`) belongs to one entry; the meal's
 * components stay shared. Every reader that computes from an entry's
 * ingredients — the shopping list, the pantry deduction, nutrition, the
 * preference conflicts, the tips and cook-question prompts, the MCP read —
 * merges the entry's changes first, through `applyEntryChanges`, so they
 * cannot drift.
 *
 * Pure: no Prisma. The selects that feed it live with each reader.
 */

/** A meal component as a reader selects it, with the ingredient shape that reader needs. */
export interface MergeableComponent<I> {
  ingredientId: string
  quantityPerServing: number
  isVague?: boolean
  originalPhrase?: string | null
  ingredient: I
}

/**
 * A change row, with the replacement ingredient in the reader's shape.
 *
 * - `originalIngredientId` null: an added ingredient.
 * - `replacementIngredientId` null: the original is left out.
 * - both set: the original is replaced, at `quantityPerServing` in the
 *   replacement's `defaultUnit`.
 */
export interface EntryChangeRow<I> {
  id: string
  originalIngredientId: string | null
  replacementIngredientId: string | null
  quantityPerServing: number | null
  replacementIngredient: I | null
}

/** A component after the merge. An added row has no `MealComponent` behind it. */
export interface MergedComponent<I> {
  ingredientId: string
  quantityPerServing: number
  isVague: boolean
  originalPhrase: string | null
  ingredient: I
}

function base<I>(component: MergeableComponent<I>): MergedComponent<I> {
  return {
    ingredientId: component.ingredientId,
    quantityPerServing: component.quantityPerServing,
    isVague: component.isVague ?? false,
    originalPhrase: component.originalPhrase ?? null,
    ingredient: component.ingredient,
  }
}

/** The replacement as a component, or null when the row is a leave-out (or malformed). */
function replacementOf<I>(change: EntryChangeRow<I>): MergedComponent<I> | null {
  if (
    change.replacementIngredientId === null ||
    change.replacementIngredient === null ||
    change.quantityPerServing === null
  ) {
    return null
  }
  return {
    ingredientId: change.replacementIngredientId,
    quantityPerServing: change.quantityPerServing,
    // A measured amount: the cook typed a number.
    isVague: false,
    originalPhrase: null,
    ingredient: change.replacementIngredient,
  }
}

/**
 * The meal's components with the entry's changes applied:
 *
 * - an original with no replacement drops that component;
 * - an original with a replacement swaps the ingredient and the quantity, in
 *   the original's place;
 * - an add row appends a component, in the order `changes` lists them.
 *
 * A change whose original is no longer in the meal (the recipe was edited
 * after the change) does nothing here; `staleChangeIds` names it.
 */
export function applyEntryChanges<I>(
  components: readonly MergeableComponent<I>[],
  changes: readonly EntryChangeRow<I>[],
): MergedComponent<I>[] {
  if (changes.length === 0) return components.map(base)

  const byOriginal = new Map<string, EntryChangeRow<I>>()
  for (const change of changes) {
    if (change.originalIngredientId !== null) byOriginal.set(change.originalIngredientId, change)
  }

  const merged: MergedComponent<I>[] = []
  for (const component of components) {
    const change = byOriginal.get(component.ingredientId)
    if (!change) {
      merged.push(base(component))
      continue
    }
    const replacement = replacementOf(change)
    if (replacement) merged.push(replacement)
  }

  for (const change of changes) {
    if (change.originalIngredientId !== null) continue
    const added = replacementOf(change)
    if (added) merged.push(added)
  }

  return merged
}

/**
 * The ids of the changes `applyEntryChanges` ignores, because their original
 * is no longer one of `components`. The UI shows these as "No longer in the
 * recipe", with only Undo.
 */
export function staleChangeIds(
  components: readonly { ingredientId: string }[],
  changes: readonly Pick<EntryChangeRow<unknown>, 'id' | 'originalIngredientId'>[],
): Set<string> {
  const inMeal = new Set(components.map((c) => c.ingredientId))
  const stale = new Set<string>()
  for (const change of changes) {
    if (change.originalIngredientId !== null && !inMeal.has(change.originalIngredientId)) {
      stale.add(change.id)
    }
  }
  return stale
}

/**
 * A fingerprint of an entry's change set, for the guards that re-check it: the
 * completion that priced a deduction from it, and the tips cache that priced a
 * prompt from it. The ids, sorted, so an undo followed by a new change still
 * reads as moved even though the count did not.
 */
export function changeSetKey(changes: readonly { id: string }[]): string {
  return changes
    .map((c) => c.id)
    .sort()
    .join(',')
}

/**
 * An entry's change rows as the pantry deduction reads them: ingredient ids
 * only, oldest first, so `applyEntryChanges` appends added rows in the order
 * they were made.
 */
export const ENTRY_CHANGES_FOR_DEDUCTION = {
  orderBy: { createdAt: 'asc' },
  select: {
    id: true,
    originalIngredientId: true,
    replacementIngredientId: true,
    quantityPerServing: true,
    replacementIngredient: { select: { id: true } },
  },
} as const
