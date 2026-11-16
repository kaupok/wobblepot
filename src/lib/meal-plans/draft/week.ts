import type { DraftContext, DraftView, StoredEntry } from './context'
import { type DraftItem, type DraftSlot, slotKey } from './schema'
import { draftDays, mainAt } from './view'

/** One slot of the week as it is after the draft. */
export interface WeekSlot {
  date: string
  mealType: DraftSlot['mealType']
  /** True when the draft names this slot. */
  changed: boolean
  /** The entry's id: null for an empty slot, and for a draft slot `check_plan` has not written. */
  entryId: string | null
  kind: 'recipe' | 'fridge' | 'empty'
  status: 'planned' | 'cooked' | 'skipped' | null
  mealId: string | null
  mealName: string | null
  timeMinutes: number | null
  primaryProteinType: string | null
  /** The meal's own servings; null for a fridge meal or an empty slot. */
  servings: number | null
  /** Own servings plus the servings its leftover meals take (`getCookServings`). */
  cookServings: number | null
  /** A fridge meal's items, in the draft's input shape. */
  items: DraftItem[]
}

export interface WeekDay {
  date: string
  slots: WeekSlot[]
}

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'] as const

/**
 * The draft's days as they will be: every slot of each day the draft names.
 * `entryIds` are the ids `apply_plan` wrote, by `slotKey`.
 */
export function buildWeek(
  ctx: DraftContext,
  view: DraftView,
  entryIds: ReadonlyMap<string, string> = new Map(),
): WeekDay[] {
  const leftovers = leftoverServingsBySource(ctx, view)

  return draftDays(view).map((date) => ({
    date,
    slots: MEAL_TYPES.map((mealType): WeekSlot => {
      const key = slotKey({ date, mealType })
      const main = mainAt(ctx, view, key)
      const base = {
        date,
        mealType,
        changed: view.named.has(key),
        entryId: null,
        kind: 'empty' as const,
        status: null,
        mealId: null,
        mealName: null,
        timeMinutes: null,
        primaryProteinType: null,
        servings: null,
        cookServings: null,
        items: [],
      }
      if (!main) return base

      if (main.from === 'draft') {
        const entryId = entryIds.get(key) ?? null
        if ('items' in main.slot) {
          return { ...base, entryId, kind: 'fridge', status: 'planned', items: main.slot.items }
        }
        if (!('mealId' in main.slot)) return base
        const meal = ctx.meals.get(main.slot.mealId)
        const own = main.slot.servings ?? ctx.householdServings
        return {
          ...base,
          entryId,
          kind: 'recipe',
          status: 'planned',
          mealId: main.slot.mealId,
          mealName: meal?.name ?? null,
          timeMinutes: meal?.timeMinutes ?? null,
          primaryProteinType: meal?.primaryProteinType ?? null,
          servings: own,
          cookServings: own + (leftovers.get(key) ?? 0),
        }
      }

      const { entry } = main
      const status =
        entry.status === 'completed' ? 'cooked' : entry.status === 'skipped' ? 'skipped' : 'planned'
      if (entry.kind === 'fridge') {
        return {
          ...base,
          entryId: entry.id,
          kind: 'fridge',
          status,
          items: entry.items.map((item) => toDraftItem(item, () => false)),
        }
      }
      const own = entry.servingOverride ?? ctx.householdServings
      return {
        ...base,
        entryId: entry.id,
        kind: entry.mealId ? 'recipe' : 'empty',
        status,
        mealId: entry.mealId,
        mealName: entry.meal?.name ?? null,
        timeMinutes: entry.meal?.timeMinutes ?? null,
        primaryProteinType: entry.meal?.primaryProteinType ?? null,
        servings: entry.mealId ? own : null,
        cookServings: !entry.mealId
          ? null
          : entry.status === 'completed'
            ? (entry.cookedServings ?? own)
            : own + (leftovers.get(key) ?? 0),
      }
    }),
  }))
}

/**
 * The servings each source slot's leftover meals take after the draft, by
 * `slotKey`: the draft's fridge meals (`draftLeftoverServings`), and the kept
 * lunches of a kept source. A skipped lunch takes nothing, as
 * `cookServingsSelect` counts.
 */
function leftoverServingsBySource(ctx: DraftContext, view: DraftView): Map<string, number> {
  const totals = draftLeftoverServings(ctx, view)
  for (const [key, entry] of ctx.mains) {
    if (view.named.has(key)) continue
    for (const lunch of entry.leftoverItems) {
      if (lunch.status === 'skipped' || view.named.has(slotKey(lunch))) continue
      totals.set(key, (totals.get(key) ?? 0) + (lunch.servings ?? 0))
    }
  }
  return totals
}

/** The servings the draft's own fridge meals take from each source slot, by `slotKey`. */
export function draftLeftoverServings(ctx: DraftContext, view: DraftView): Map<string, number> {
  const totals = new Map<string, number>()
  const add = (key: string, servings: number | undefined) =>
    totals.set(key, (totals.get(key) ?? 0) + (servings ?? 0))
  for (const slot of view.named.values()) {
    if (!('items' in slot)) continue
    for (const item of slot.items) {
      if ('leftoverOf' in item) add(slotKey(item.leftoverOf), item.servings)
      if ('sourceEntryId' in item) {
        const source = ctx.stored.get(item.sourceEntryId)
        if (source) add(slotKey(source), item.servings)
      }
    }
  }
  return totals
}

/**
 * A stored fridge item in the draft's input shape. `isNamed` says whether the
 * source's slot is in the draft, so it is named by slot (`leftoverOf`) and
 * not by an id the write replaces.
 */
export function toDraftItem(
  item: StoredEntry['items'][number],
  isNamed: (key: string) => boolean,
): DraftItem {
  if (item.ingredientId) return { ingredientId: item.ingredientId }
  if (item.sourceEntryId) {
    const servings = item.servings === null ? {} : { servings: item.servings }
    return item.source && isNamed(slotKey(item.source))
      ? { leftoverOf: item.source, ...servings }
      : { sourceEntryId: item.sourceEntryId, ...servings }
  }
  return { label: item.label ?? '' }
}
