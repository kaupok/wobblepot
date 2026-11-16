import { parseLocalDate, toDateString } from '@/lib/meal-planning/dates'

import type { SourceRow } from '../recent-meals'
import type { DraftContext, DraftView, StoredEntry } from './context'
import { type DraftSlot, slotKey } from './schema'

/** A slot's main after the draft: the draft's slot, the kept stored main, or none. */
export type PlannedMain = { from: 'draft'; slot: DraftSlot } | { from: 'kept'; entry: StoredEntry }

/** The draft's named slots, each at its first occurrence; a repeat is `duplicateSlot`. */
export function buildView(slots: readonly DraftSlot[]): DraftView {
  const named = new Map<string, DraftSlot>()
  for (const slot of slots) {
    const key = slotKey(slot)
    if (!named.has(key)) named.set(key, slot)
  }
  return { named }
}

export function mainAt(ctx: DraftContext, view: DraftView, key: string): PlannedMain | null {
  const slot = view.named.get(key)
  if (slot) return 'clear' in slot ? null : { from: 'draft', slot }
  const entry = ctx.mains.get(key)
  // A placeholder (no meal, no note, no items) is an empty slot (HON-1251).
  if (!entry || isPlaceholder(entry)) return null
  return { from: 'kept', entry }
}

export function isPlaceholder(entry: StoredEntry): boolean {
  return entry.kind === 'meal' && entry.mealId === null && entry.note === null
}

/** The meal a planned main cooks, or null for a fridge meal or a note-only card. */
export function plannedMealId(main: PlannedMain | null): string | null {
  if (!main) return null
  if (main.from === 'draft') return 'mealId' in main.slot ? main.slot.mealId : null
  return main.entry.kind === 'meal' ? main.entry.mealId : null
}

/** A planned main as the leftover source rule reads it. */
export function toSourceRow(main: PlannedMain): SourceRow {
  if (main.from === 'kept') return { ...main.entry, date: parseLocalDate(main.entry.date) }
  const mealId = 'mealId' in main.slot ? main.slot.mealId : null
  return {
    date: parseLocalDate(main.slot.date),
    mealType: main.slot.mealType,
    status: 'planned',
    kind: mealId ? 'meal' : 'fridge',
    mealId,
    mainEntryId: null,
  }
}

export function addDays(date: string, days: number): string {
  const day = parseLocalDate(date)
  day.setDate(day.getDate() + days)
  return toDateString(day)
}

/** The draft's days, sorted, each once. */
export function draftDays(view: DraftView): string[] {
  return [...new Set([...view.named.values()].map((slot) => slot.date))].sort()
}
