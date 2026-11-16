import 'server-only'

import { findOrCreateMealPlan } from '../plans'
import { writeDraft } from './apply'
import type { DraftHousehold } from './context'
import { loadDraftContext } from './load'
import { buildNeeds, type DraftNeed } from './needs'
import { previousSlots } from './previous'
import { isRestore, signRestore } from './restore-token'
import { type DraftProblem, type DraftWarning, findProblems, findWarnings } from './rules'
import { type DraftSlot, draftSlotsSchema } from './schema'
import { buildView } from './view'
import { buildWeek, type WeekDay } from './week'

/**
 * A draft week (HON-1652): `checkDraft` judges it against the household's
 * rules and writes nothing; `applyDraft` runs the same check and writes it
 * all, or nothing. The MCP `check_plan` and `apply_plan` tools call these,
 * and so will the planning chat (HON-1650).
 */

export type { DraftHousehold } from './context'
export type { DraftNeed } from './needs'
export type { DraftProblem, DraftWarning } from './rules'
export { draftItemSchema, type DraftSlot, draftSlotSchema, draftSlotsSchema } from './schema'
export type { WeekDay, WeekSlot } from './week'

export interface DraftCheck {
  problems: DraftProblem[]
  warnings: DraftWarning[]
  needs: DraftNeed[]
  week: WeekDay[]
}

export type DraftApply =
  | { outcome: 'refused'; problems: DraftProblem[]; warnings: DraftWarning[] }
  | {
      outcome: 'applied'
      week: WeekDay[]
      warnings: DraftWarning[]
      previous: DraftSlot[]
      /** Proves `previous` is this call's own, for the Undo (`isRestore`). */
      restoreToken: string
    }

export async function checkDraft(
  household: DraftHousehold,
  slots: readonly DraftSlot[],
): Promise<DraftCheck> {
  const ctx = await loadDraftContext(household, slots)
  const view = buildView(slots)
  const week = buildWeek(ctx, view)
  return {
    problems: findProblems(ctx, view, slots),
    warnings: findWarnings(ctx, view),
    needs: buildNeeds(ctx, week),
    week,
  }
}

/** `restoreToken` is the one an earlier call returned with the `previous` now sent as `slots`. */
export async function applyDraft(
  household: DraftHousehold,
  slots: readonly DraftSlot[],
  restoreToken?: string,
): Promise<DraftApply> {
  const ctx = await loadDraftContext(household, slots)
  const view = buildView(slots)
  const restore = isRestore(household.id, slots, restoreToken)
  const problems = findProblems(ctx, view, slots, restore)
  const warnings = findWarnings(ctx, view)
  if (problems.length > 0) return { outcome: 'refused', problems, warnings }

  // Parsed, so the token signs the slots in the key order an Undo call parses them to.
  const previous = draftSlotsSchema.parse(previousSlots(ctx, view))
  const planId = await findOrCreateMealPlan(household.id)
  const entryIds = await writeDraft(ctx, view, planId)
  return {
    outcome: 'applied',
    week: buildWeek(ctx, view, entryIds),
    warnings,
    previous,
    restoreToken: signRestore(household.id, previous),
  }
}
