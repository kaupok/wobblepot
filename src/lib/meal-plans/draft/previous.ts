import { FRIDGE_ITEM_LABEL_MAX, FRIDGE_ITEMS_MAX } from '../fridge-items'
import type { DraftContext, DraftView, StoredEntry } from './context'
import type { DraftSlot } from './schema'
import { isPlaceholder } from './view'
import { toDraftItem } from './week'

/**
 * The slots a draft changes, as they are before it is written, in the draft's
 * own input shape: `apply_plan` with them puts the old week back (the Undo).
 *
 * An empty slot is `clear`. A leftover whose source the draft also changes is
 * `leftoverOf`, because the write gives that source a new id; any other is
 * its `sourceEntryId`. `apply_plan` signs them (`signRestore`), so a source
 * changed since the link was saved does not refuse the Undo. The shape has no skip, so a skipped meal comes back
 * planned. A note, sides and Adjust recipe changes are not restored
 * (`losesChanges`).
 */
export function previousSlots(ctx: DraftContext, view: DraftView): DraftSlot[] {
  return [...view.named].map(([key, { date, mealType }]): DraftSlot => {
    const entry = ctx.mains.get(key)
    if (!entry || isPlaceholder(entry)) return { date, mealType, clear: true }
    const items = fitItems(entry.items)
    if (entry.kind === 'fridge' && items.length > 0) {
      return {
        date,
        mealType,
        items: items.map((item) => toDraftItem(item, (source) => view.named.has(source))),
      }
    }
    if (entry.kind === 'meal' && entry.mealId) {
      return {
        date,
        mealType,
        mealId: entry.mealId,
        ...(entry.servingOverride !== null && { servings: entry.servingOverride }),
      }
    }
    // A note-only card: the note is what `losesChanges` names.
    return { date, mealType, clear: true }
  })
}

/**
 * A stored fridge meal's items as the draft's input takes them, so `previous`
 * always parses. A lunch saved before HON-1441 can name one dinner twice, and
 * the table enforces neither that rule nor the input's limits: the first link
 * to each source stays, and a label or a list past its limit is cut.
 */
function fitItems(items: StoredEntry['items']): StoredEntry['items'] {
  const sources = new Set<string>()
  return items
    .filter((item) => {
      if (item.sourceEntryId === null)
        return item.ingredientId !== null || Boolean(item.label?.trim())
      if (sources.has(item.sourceEntryId)) return false
      sources.add(item.sourceEntryId)
      return true
    })
    .slice(0, FRIDGE_ITEMS_MAX)
    .map((item) =>
      item.label ? { ...item, label: item.label.trim().slice(0, FRIDGE_ITEM_LABEL_MAX) } : item,
    )
}
