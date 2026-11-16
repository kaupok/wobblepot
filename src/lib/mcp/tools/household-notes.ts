import 'server-only'

import { z } from 'zod'

import { getHouseholdMembership } from '@/lib/household'
import { ToolInputError } from '@/lib/mcp/context'

/** What both note tools answer to a member who is not the owner. */
export const NOT_OWNER_MESSAGE =
  "Only the household's owner can change the household notes. The owner changes them on Household → Meal preferences in Wobblepot. Nothing was changed."

/** The note text both tools accept: one line, as the form stores one note per line. */
export const noteText = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\r\n]*$/, 'A note is one line.')

export const notesOutput = z
  .array(z.string())
  .describe(
    'Every household note after this call, in order: what get_household returns as restrictions.',
  )

/** The owner check that `PATCH /api/households/me/preferences` also makes. */
export async function requireOwner(userId: string) {
  const membership = await getHouseholdMembership(userId)
  if (membership?.role !== 'owner') throw new ToolInputError(NOT_OWNER_MESSAGE)
}

/** The refusal for a note text that matches no note, with the notes the model can pick from. */
export function noMatchError(notes: readonly string[]) {
  const current =
    notes.length === 0
      ? 'The household has no notes yet.'
      : `The current notes are: ${JSON.stringify(notes)}.`
  return new ToolInputError(
    `No note has exactly this text. ${current} Copy a note's text exactly. Nothing was changed.`,
  )
}
