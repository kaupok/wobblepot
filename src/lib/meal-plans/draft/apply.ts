import 'server-only'

import { parseLocalDate } from '@/lib/meal-planning/dates'
import { prisma } from '@/lib/prisma'

import type { DraftContext, DraftView } from './context'
import { type DraftSlot, slotKey } from './schema'

/**
 * Writes a checked draft in one transaction (HON-1652): each named slot's
 * entries, main and sides, are deleted, then every new entry is created, then
 * the fridge meals' items, whose leftovers need their source's id. Creating
 * the entries first means a leftover finds its source in any order, a fridge
 * meal in the same draft too (a restored link may point at one). A failure
 * anywhere leaves the plan as it was. Returns the new entry ids by `slotKey`.
 *
 * The check runs before, outside the transaction. A write that fills a slot
 * in between fails the one-main-per-slot index, so the draft still writes
 * nothing.
 */
export async function writeDraft(
  ctx: DraftContext,
  view: DraftView,
  planId: string,
): Promise<Map<string, string>> {
  const slots = [...view.named.values()]
  const dayOf = (slot: DraftSlot) => {
    const day = parseLocalDate(slot.date)
    const next = new Date(day)
    next.setDate(next.getDate() + 1)
    return { gte: day, lt: next }
  }

  return prisma.$transaction(async (tx) => {
    await tx.mealPlanEntry.deleteMany({
      where: {
        planId,
        OR: slots.map((slot) => ({ date: dayOf(slot), mealType: slot.mealType })),
      },
    })

    const created = new Map<string, string>()
    for (const slot of slots) {
      if ('clear' in slot) continue
      const entry = await tx.mealPlanEntry.create({
        data: {
          planId,
          date: parseLocalDate(slot.date),
          mealType: slot.mealType,
          ...('mealId' in slot
            ? { mealId: slot.mealId, servingOverride: slot.servings ?? null }
            : { kind: 'fridge' }),
        },
        select: { id: true },
      })
      created.set(slotKey(slot), entry.id)
    }

    // A named slot's stored entry is gone, so its source is the new entry;
    // any other slot's is the kept one.
    const sourceId = (key: string) =>
      view.named.has(key) ? created.get(key) : ctx.mains.get(key)?.id
    const rows = slots.flatMap((slot) => {
      if (!('items' in slot)) return []
      const entryId = created.get(slotKey(slot))!
      return slot.items.map((item, position) => {
        const sourceEntryId =
          'sourceEntryId' in item
            ? item.sourceEntryId
            : 'leftoverOf' in item
              ? sourceId(slotKey(item.leftoverOf))
              : null
        // The check refuses a `leftoverOf` an empty slot (`itemNotFound`).
        if (sourceEntryId === undefined) throw new Error('Draft leftover source has no entry')
        return {
          entryId,
          position,
          ingredientId: 'ingredientId' in item ? item.ingredientId : null,
          label: 'label' in item ? item.label : null,
          sourceEntryId,
          servings: sourceEntryId && 'servings' in item ? (item.servings ?? null) : null,
        }
      })
    })
    if (rows.length > 0) await tx.mealPlanEntryItem.createMany({ data: rows })
    return created
  })
}
