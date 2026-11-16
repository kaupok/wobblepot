import 'server-only'

import { parseLocalDate } from '@/lib/meal-planning/dates'
import { prisma } from '@/lib/prisma'

import type { DraftContext, DraftView } from './context'
import { type DraftSlot, slotKey } from './schema'

/**
 * Writes a checked draft in one transaction (HON-1652): each named slot's
 * entries, main and sides, are deleted, then the recipe meals are created,
 * then the fridge meals, whose leftovers need their source's id. A failure
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
      if (!('mealId' in slot)) continue
      const entry = await tx.mealPlanEntry.create({
        data: {
          planId,
          date: parseLocalDate(slot.date),
          mealType: slot.mealType,
          mealId: slot.mealId,
          servingOverride: slot.servings ?? null,
        },
        select: { id: true },
      })
      created.set(slotKey(slot), entry.id)
    }

    for (const slot of slots) {
      if (!('items' in slot)) continue
      const entry = await tx.mealPlanEntry.create({
        data: {
          planId,
          date: parseLocalDate(slot.date),
          mealType: slot.mealType,
          kind: 'fridge',
          items: {
            create: slot.items.map((item, position) => {
              const sourceEntryId =
                'sourceEntryId' in item
                  ? item.sourceEntryId
                  : 'leftoverOf' in item
                    ? sourceId(ctx, created, slotKey(item.leftoverOf))
                    : null
              return {
                position,
                ingredientId: 'ingredientId' in item ? item.ingredientId : null,
                label: 'label' in item ? item.label : null,
                sourceEntryId,
                servings: sourceEntryId && 'servings' in item ? (item.servings ?? null) : null,
              }
            }),
          },
        },
        select: { id: true },
      })
      created.set(slotKey(slot), entry.id)
    }
    return created
  })
}

/** A `leftoverOf` source's id: the main the draft just wrote, or the kept one. */
function sourceId(ctx: DraftContext, created: Map<string, string>, key: string): string {
  const id = created.get(key) ?? ctx.mains.get(key)?.id
  // The check refuses a `leftoverOf` an empty slot (`itemNotFound`).
  if (!id) throw new Error(`Draft leftover source ${key} has no entry`)
  return id
}
