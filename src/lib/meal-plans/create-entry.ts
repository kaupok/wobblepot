import 'server-only'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { toDateString } from '@/lib/meal-planning/dates'
import type { FridgeItemInput } from './fridge-items'
import { toItemRows } from './fridge-meal'

/**
 * Why `createEntry` refused a request. The route maps each one to its status:
 *
 * - `planNotFound`: no such plan of this household (404).
 * - `slotTaken`: the slot already has an entry with a meal, a note or fridge
 *   items, which is also how a restore after Clear leaves a refilled slot
 *   alone (409).
 * - `mealNotFound`: the meal does not exist, is deleted, or is another
 *   household's (404).
 */
export type EntryCreateRefusal = 'planNotFound' | 'slotTaken' | 'mealNotFound'

export class EntryCreateError extends Error {
  constructor(readonly reason: EntryCreateRefusal) {
    super(`Entry create refused: ${reason}`)
    this.name = 'EntryCreateError'
  }
}

/**
 * The validated body of a new entry. `fridgeItems` makes it a fridge meal
 * with no `mealId` (HON-1277). The fields past `mealId` are for Undo after
 * Clear, which posts the cleared entry back (HON-1123).
 */
export interface NewEntry {
  date: Date
  mealType: 'breakfast' | 'lunch' | 'dinner'
  mealId?: string
  fridgeItems?: FridgeItemInput[]
  note?: string | null
  noteX?: number | null
  noteY?: number | null
  status?: 'planned' | 'skipped'
  servingOverride?: number | null
  rating?: 'up' | 'down' | null
  pantryDeducted?: boolean
}

/**
 * Creates an entry in an empty slot of a plan the household owns. Throws
 * `EntryCreateError` for every refusal.
 */
export async function createEntry(householdId: string, planId: string, input: NewEntry) {
  const plan = await prisma.mealPlan.findFirst({
    where: { id: planId, householdId },
    select: { id: true },
  })

  if (!plan) {
    throw new EntryCreateError('planNotFound')
  }

  const slot = { planId, date: input.date, mealType: input.mealType }
  const existingEntry = await prisma.mealPlanEntry.findFirst({
    where: slot,
    select: { mealId: true, note: true, kind: true },
  })

  if (
    existingEntry &&
    (existingEntry.mealId !== null || existingEntry.note !== null || existingEntry.kind !== 'meal')
  ) {
    throw new EntryCreateError('slotTaken')
  }

  // The meal must be one this household may see — a system meal or one of its
  // own. Without the filter a foreign meal can be attached at creation time
  // instead of at swap time.
  if (input.mealId) {
    const meal = await prisma.meal.findFirst({
      where: {
        id: input.mealId,
        deletedAt: null,
        OR: [{ householdId: null }, { householdId }],
      },
      select: { id: true },
    })

    if (!meal) {
      throw new EntryCreateError('mealNotFound')
    }
  }

  // Throws `FridgeItemNotFoundError` for a source the household may not see.
  const itemRows = input.fridgeItems ? await toItemRows(householdId, input.fridgeItems) : null

  // An entry with no meal, no note and no items is a picker placeholder whose
  // discard never ran, so the new entry replaces it (HON-1251). A write that
  // filled the slot since the read fails the unique index: the slot is taken.
  const [, entry] = await prisma
    .$transaction([
      prisma.mealPlanEntry.deleteMany({
        where: { ...slot, mealId: null, note: null, kind: 'meal' },
      }),
      prisma.mealPlanEntry.create({
        data: {
          ...slot,
          mealId: input.mealId ?? null,
          ...(itemRows && { kind: 'fridge', items: { create: itemRows } }),
          status: input.status ?? 'planned',
          note: input.note ?? null,
          noteX: input.noteX ?? null,
          noteY: input.noteY ?? null,
          servingOverride: input.servingOverride ?? null,
          rating: input.rating ?? null,
          // "Not cooked yet" keeps the charge on the entry so it is charged at
          // most once (HON-651). A restore of such an entry keeps it too, or the
          // next completion would charge the pantry again. The flag can only
          // stop a charge, never cause one.
          pantryDeductedAt: input.pantryDeducted ? new Date() : null,
        },
      }),
    ])
    .catch((error: unknown) => {
      throw error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
        ? new EntryCreateError('slotTaken')
        : error
    })

  return {
    id: entry.id,
    date: toDateString(entry.date),
    mealType: entry.mealType,
    status: entry.status,
    mealId: entry.mealId,
    note: entry.note,
  }
}
