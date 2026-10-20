import 'server-only'
import { prisma } from '@/lib/prisma'
import { slotKey } from '@/lib/ai/slot-key'
import type { MealType } from '@/generated/prisma/enums'

/** A meal the fill puts in a slot. */
export interface FilledSlot {
  date: Date
  mealType: MealType
  mealId: string
}

/** An entry with no meal in a slot the fill fills. */
export interface EmptySlotEntry {
  id: string
  date: Date
  mealType: MealType
  note: string | null
}

/**
 * Writes the meals a Generate or Fill days run picked, in one transaction.
 *
 * `emptyEntries` are the entries with no meal in the slots it fills. One with a
 * note is the household's note slip, so it gets the meal and keeps its id and
 * note. One with no note is a leaked placeholder, so it is deleted and its slot
 * gets a new entry (HON-1251, HON-1252).
 */
export async function writeFilledSlots(
  planId: string,
  fills: FilledSlot[],
  emptyEntries: EmptySlotEntry[],
): Promise<void> {
  const placeholderIds = emptyEntries.filter((e) => e.note === null).map((e) => e.id)
  const noteEntryIds = new Map(
    emptyEntries.filter((e) => e.note !== null).map((e) => [slotKey(e.date, e.mealType), e.id]),
  )
  const updates = fills.flatMap((fill) => {
    const id = noteEntryIds.get(slotKey(fill.date, fill.mealType))
    return id ? [{ id, fill }] : []
  })

  await prisma.$transaction(async (tx) => {
    const creates = fills.filter((fill) => !noteEntryIds.has(slotKey(fill.date, fill.mealType)))
    // The model call takes a while, so the household may have changed an entry
    // since the fill read it. Each write checks the entry still has no meal,
    // so a pick or note made meanwhile is never deleted or overwritten.
    if (placeholderIds.length > 0) {
      await tx.mealPlanEntry.deleteMany({
        where: { id: { in: placeholderIds }, mealId: null, note: null },
      })
    }
    for (const update of updates) {
      // A note slip deleted meanwhile leaves its slot open for a new entry.
      const { count } = await tx.mealPlanEntry.updateMany({
        where: { id: update.id, mealId: null },
        data: { mealId: update.fill.mealId, status: 'planned' },
      })
      if (count === 0) creates.push(update.fill)
    }
    await tx.mealPlanEntry.createMany({
      data: creates.map((fill) => ({
        planId,
        date: fill.date,
        mealType: fill.mealType,
        mealId: fill.mealId,
        status: 'planned',
      })),
    })
  })
}
