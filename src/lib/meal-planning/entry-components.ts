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
 * A stale change (`isStale`) does nothing here; `staleChangeIds` names it.
 */
export function applyEntryChanges<I>(
  components: readonly MergeableComponent<I>[],
  changes: readonly EntryChangeRow<I>[],
): MergedComponent<I>[] {
  if (changes.length === 0) return components.map(base)

  const inMeal = new Set(components.map((c) => c.ingredientId))
  const live = changes.filter((change) => !isStale(inMeal, change))
  const byOriginal = new Map<string, EntryChangeRow<I>>()
  for (const change of live) {
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

  for (const change of live) {
    if (change.originalIngredientId !== null) continue
    const added = replacementOf(change)
    if (added) merged.push(added)
  }

  return merged
}

type StaleCheckedChange = Pick<
  EntryChangeRow<unknown>,
  'id' | 'originalIngredientId' | 'replacementIngredientId'
>

/**
 * A change the recipe was edited out from under, so it no longer fits:
 *
 * - its original is no longer in the meal, so there is nothing to replace or
 *   leave out;
 * - or the ingredient it brings in is now in the recipe itself, so applying
 *   it would list that ingredient twice, and the shopping list and the
 *   deduction would count it twice. `addEntryChange` refuses this at write
 *   time; a later recipe edit is what makes it true.
 */
function isStale(inMeal: ReadonlySet<string>, change: StaleCheckedChange): boolean {
  if (change.originalIngredientId !== null && !inMeal.has(change.originalIngredientId)) {
    return true
  }
  return change.replacementIngredientId !== null && inMeal.has(change.replacementIngredientId)
}

/**
 * The ids of the changes `applyEntryChanges` ignores, because the recipe was
 * edited after them (`isStale`). The UI shows these as no longer fitting the
 * recipe, with only Undo.
 */
export function staleChangeIds(
  components: readonly { ingredientId: string }[],
  changes: readonly StaleCheckedChange[],
): Set<string> {
  const inMeal = new Set(components.map((c) => c.ingredientId))
  return new Set(changes.filter((change) => isStale(inMeal, change)).map((change) => change.id))
}

/**
 * The entry has at least one change `applyEntryChanges` applies, so what it
 * cooks differs from the recipe and the meal's name. The AI prompts then say
 * the list is the whole meal (HON-1254). A stale change applies nothing.
 */
export function hasLiveChanges(
  components: readonly { ingredientId: string }[],
  changes: readonly StaleCheckedChange[],
): boolean {
  const inMeal = new Set(components.map((c) => c.ingredientId))
  return changes.some((change) => !isStale(inMeal, change))
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
