import type { DraftContext, DraftView } from './context'
import type { DraftSlot } from './schema'
import { isPlaceholder } from './view'
import { toDraftItem } from './week'

/**
 * The slots a draft changes, as they are before it is written, in the draft's
 * own input shape: `apply_plan` with them puts the old week back (the Undo).
 *
 * An empty slot is `clear`. A leftover whose source the draft also changes is
 * `leftoverOf`, because the write gives that source a new id; any other is
 * its `sourceEntryId`. Each is marked `restore`, so a source changed since the
 * link was saved does not refuse the Undo. The shape has no skip, so a skipped meal comes back
 * planned. A note, sides and Adjust recipe changes are not restored
 * (`losesChanges`).
 */
export function previousSlots(ctx: DraftContext, view: DraftView): DraftSlot[] {
  return [...view.named].map(([key, { date, mealType }]): DraftSlot => {
    const entry = ctx.mains.get(key)
    if (!entry || isPlaceholder(entry)) return { date, mealType, clear: true }
    if (entry.kind === 'fridge' && entry.items.length > 0) {
      return {
        date,
        mealType,
        items: entry.items.map((item) =>
          toDraftItem(item, (source) => view.named.has(source), true),
        ),
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
