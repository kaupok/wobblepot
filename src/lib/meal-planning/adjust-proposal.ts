import type { Unit } from '@/generated/prisma/enums'
import { convertQuantity } from '@/lib/ai/recipe-quantities'
import type { AdjustOp, AdjustRecipeChange } from '@/lib/ai/adjust-recipe'
import { MAX_QUANTITY_PER_SERVING, type EntryChangeInput } from './components-schema'

/**
 * The pure half of "Adjust recipe" (HON-1244): the model's changes, named
 * against the meal as it is now, become proposals the household reviews, and
 * the accepted ones become the entry's new change set.
 *
 * The model sees the merged components, so it may name a replacement an
 * earlier change brought in ("swap the yoghurt" after cream → yoghurt). A
 * change row's original must be a recipe ingredient, so that proposal changes
 * the cream row: `originalIngredientId` is the cream, and `replacesChangeId`
 * names the row it supersedes.
 *
 * No Prisma and no `server-only`: the review dialog builds the set with
 * `buildChangeSet` and `pickedQuantity`.
 */

/** A replacement the catalogue matched, with its amount in the ingredient's own unit. */
export interface MatchedReplacement {
  matched: true
  ingredient: { id: string; name: string; defaultUnit: Unit; measuredByVolume: boolean }
  quantityPerServing: number
}

/** A replacement name the catalogue did not match: the household picks the ingredient. */
export interface UnmatchedReplacement {
  matched: false
  name: string
  /** Per serving, in `unit`; converted to the picked ingredient's unit by `pickedQuantity`. */
  quantity: number
  unit: Unit
}

export type AdjustReplacement = MatchedReplacement | UnmatchedReplacement

/** One proposed change, as `POST .../adjust` returns it. */
export interface AdjustProposal {
  op: AdjustOp
  /** The ingredient as the meal shows it now; null for an add. */
  original: { id: string; name: string } | null
  /** The recipe ingredient the change row changes; null for an add, or for an added ingredient. */
  originalIngredientId: string | null
  /** The earlier change the proposal supersedes: the one that brought `original` in. */
  replacesChangeId: string | null
  /** Null for a remove. */
  replacement: AdjustReplacement | null
  /** The model's sentence, in the household's language. */
  reason: string
}

/** A merged component as the resolver needs it. */
export interface ResolvableComponent {
  ingredientId: string
  /** In the household's language: the name the prompt listed. */
  name: string
}

/** A live change row: one `applyEntryChanges` applies. */
export interface ResolvableChange {
  id: string
  originalIngredientId: string | null
  replacementIngredientId: string | null
}

/** A model change with its original resolved, before its replacement is matched. */
export interface ResolvedChange {
  op: AdjustOp
  original: { id: string; name: string } | null
  originalIngredientId: string | null
  replacesChangeId: string | null
  /** The replacement name, quantity and unit to match; null for a remove. */
  replacement: { name: string; quantity: number; unit: Unit } | null
  reason: string
}

const normalize = (name: string) =>
  name
    .toLowerCase()
    .replace(/[.,;:!?"'()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * The merged components the model's name fits: the one with the same name,
 * ignoring case and punctuation, or else every component whose name holds the
 * model's name or is held by it ("mushrooms" for "mushroom").
 * `change_meal_ingredients` finds the change to restore by the same rule.
 */
export function fittingComponents<T extends { name: string }>(
  components: readonly T[],
  name: string,
): T[] {
  const wanted = normalize(name)
  if (!wanted) return []
  const exact = components.find((c) => normalize(c.name) === wanted)
  if (exact) return [exact]
  return components.filter((c) => {
    const have = normalize(c.name)
    return have.includes(wanted) || wanted.includes(have)
  })
}

/** The merged component the model named, or null when none or several fit. */
function findComponent(
  components: readonly ResolvableComponent[],
  name: string,
): ResolvableComponent | null {
  const fitting = fittingComponents(components, name)
  return fitting.length === 1 ? fitting[0]! : null
}

/** The replacement fields of a replace or an add, or null when the model left one out. */
function replacementOf(change: AdjustRecipeChange): ResolvedChange['replacement'] {
  const name = change.replacement?.trim()
  const quantity = change.quantityPerServing
  if (!name || quantity === null || !(quantity > 0) || change.unit === null) return null
  if (quantity > MAX_QUANTITY_PER_SERVING) return null
  return { name, quantity, unit: change.unit }
}

/**
 * The model's changes with each original resolved against the merged
 * components. Dropped: a replace or remove whose original matches no
 * component, a second change to the same component, and a replace or add with
 * no usable name, amount or unit.
 */
export function resolveChanges(
  changes: readonly AdjustRecipeChange[],
  components: readonly ResolvableComponent[],
  liveChanges: readonly ResolvableChange[],
): ResolvedChange[] {
  const byReplacement = new Map(
    liveChanges.flatMap((c) =>
      c.replacementIngredientId ? [[c.replacementIngredientId, c] as const] : [],
    ),
  )
  const touched = new Set<string>()
  const resolved: ResolvedChange[] = []

  for (const change of changes) {
    const reason = change.reason.trim()
    if (change.op === 'add') {
      const replacement = replacementOf(change)
      if (!replacement) continue
      resolved.push({
        op: 'add',
        original: null,
        originalIngredientId: null,
        replacesChangeId: null,
        replacement,
        reason,
      })
      continue
    }

    const component = change.original ? findComponent(components, change.original) : null
    if (!component || touched.has(component.ingredientId)) continue
    const replacement = change.op === 'replace' ? replacementOf(change) : null
    if (change.op === 'replace' && !replacement) continue
    touched.add(component.ingredientId)

    // A component an earlier change brought in has that change's original
    // behind it: the recipe ingredient, or none for an added one.
    const earlier = byReplacement.get(component.ingredientId) ?? null
    resolved.push({
      op: change.op,
      original: { id: component.ingredientId, name: component.name },
      originalIngredientId: earlier ? earlier.originalIngredientId : component.ingredientId,
      replacesChangeId: earlier?.id ?? null,
      replacement,
      reason,
    })
  }
  return resolved
}

/**
 * The originals the model named that `resolveChanges` dropped, in order and
 * without a repeat: `notInMeal` when no merged component fits the name,
 * `ambiguous` when several do ("pepper" on a meal with black pepper and bell
 * pepper). The review dialog has nothing to show for them; the MCP tool
 * reports them, so the assistant can tell the user or ask which one was meant
 * (HON-1246).
 */
export function unresolvedOriginals(
  changes: readonly AdjustRecipeChange[],
  components: readonly ResolvableComponent[],
): { notInMeal: string[]; ambiguous: string[] } {
  const notInMeal: string[] = []
  const ambiguous: string[] = []
  for (const change of changes) {
    if (change.op === 'add') continue
    const name = change.original?.trim()
    if (!name || notInMeal.includes(name) || ambiguous.includes(name)) continue
    const fitting = fittingComponents(components, name).length
    if (fitting === 0) notInMeal.push(name)
    else if (fitting > 1) ambiguous.push(name)
  }
  return { notInMeal, ambiguous }
}

/** Smallest amount a change stores: the PUT refuses 0, and rounding can reach it. */
const MIN_QUANTITY_PER_SERVING = 0.01

/** An amount the PUT accepts: rounded to hundredths, within its bounds. */
export function storableQuantity(quantity: number): number {
  const rounded = Math.round(quantity * 100) / 100
  return Math.min(Math.max(rounded, MIN_QUANTITY_PER_SERVING), MAX_QUANTITY_PER_SERVING)
}

/**
 * The amount for a replacement the household picked from the search, in that
 * ingredient's own unit: the model's amount, converted as `matchIngredients`
 * converts a matched one.
 */
export function pickedQuantity(
  replacement: Pick<UnmatchedReplacement, 'quantity' | 'unit'>,
  picked: { defaultUnit: Unit; gramsPerPiece?: number | null },
): number {
  const converted = convertQuantity(replacement.quantity, replacement.unit, {
    defaultUnit: picked.defaultUnit,
    gramsPerPiece: picked.gramsPerPiece ?? null,
  })
  return storableQuantity(converted)
}

/** An accepted proposal, with the ingredient and the amount it brings in. */
export interface AcceptedProposal {
  proposal: Pick<AdjustProposal, 'op' | 'originalIngredientId' | 'replacesChangeId'>
  /** Null for a remove. */
  replacementIngredientId: string | null
  quantityPerServing: number | null
}

/** A stored change as the planner holds it (`EntryChange`). */
interface StoredChange {
  id: string
  original: { id: string } | null
  replacement: { id: string } | null
  quantityPerServing: number | null
  stale: boolean
}

function rowOf({
  proposal,
  replacementIngredientId,
  quantityPerServing,
}: AcceptedProposal): EntryChangeInput[] {
  const original = proposal.originalIngredientId
  if (proposal.op === 'remove' || replacementIngredientId === null) {
    // Removing an added ingredient is dropping the row that added it.
    return original
      ? [
          {
            originalIngredientId: original,
            replacementIngredientId: null,
            quantityPerServing: null,
          },
        ]
      : []
  }
  // Back to the recipe's own ingredient: dropping the superseded row is the change.
  if (replacementIngredientId === original) return []
  return [
    {
      originalIngredientId: proposal.op === 'add' ? null : original,
      replacementIngredientId,
      quantityPerServing,
    },
  ]
}

/**
 * The entry's change set after the accepted proposals, for
 * `PUT .../components`: the stored changes no proposal supersedes, then a row
 * per accepted proposal. Stale changes go, as the PUT replaces the whole set.
 */
export function buildChangeSet(
  stored: readonly StoredChange[],
  accepted: readonly AcceptedProposal[],
): EntryChangeInput[] {
  const superseded = new Set(accepted.flatMap((a) => a.proposal.replacesChangeId ?? []))
  const kept = stored
    .filter((c) => !c.stale && !superseded.has(c.id))
    .map((c) => ({
      originalIngredientId: c.original?.id ?? null,
      replacementIngredientId: c.replacement?.id ?? null,
      quantityPerServing: c.quantityPerServing,
    }))
  return [...kept, ...accepted.flatMap(rowOf)]
}
