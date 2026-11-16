import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

import { serverEnv } from '@/lib/env'

import type { DraftSlot } from './schema'

/**
 * The proof that a draft is `apply_plan`'s own `previous`, so its leftover
 * links pass the source changes the app's Undo after Clear passes
 * (`CHANGED_SOURCE_PROBLEMS`). A dinner skipped or made a fridge meal keeps
 * its lunches, but the write deleted the old lunch, so the server cannot see
 * the link it restores. A flag the assistant sets would let any new link skip
 * the source rule, so the server signs the slots it returned instead.
 *
 * Both sides sign the slots as `draftSlotsSchema` parses them, so the key
 * order is the schema's. Bound to the household, so one household's token
 * passes nothing for another.
 */
function sign(householdId: string, slots: readonly DraftSlot[]): Buffer {
  return createHmac('sha256', serverEnv.BETTER_AUTH_SECRET)
    .update(`draft-restore:${householdId}:${JSON.stringify(slots)}`)
    .digest()
}

export function signRestore(householdId: string, slots: readonly DraftSlot[]): string {
  return sign(householdId, slots).toString('base64url')
}

export function isRestore(
  householdId: string,
  slots: readonly DraftSlot[],
  token: string | undefined,
): boolean {
  if (!token) return false
  const given = Buffer.from(token, 'base64url')
  const expected = sign(householdId, slots)
  return given.length === expected.length && timingSafeEqual(given, expected)
}
