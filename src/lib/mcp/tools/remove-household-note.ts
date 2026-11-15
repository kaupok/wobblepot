import 'server-only'

import { z } from 'zod'

import { removeNote } from '@/lib/household/notes'
import { updateHouseholdPreferences } from '@/lib/household/preferences'
import { defineTool, WRITE_ANNOTATIONS } from '@/lib/mcp/context'

import { loadOwnerNotes, noMatchError, notesOutput } from './household-notes'

export const removeHouseholdNote = defineTool({
  name: 'remove_household_note',
  title: 'Remove a note for the AI',
  description:
    "Removes one note from the household's \"Notes for the AI\" (restrictions in get_household). Use it when the user says a rule no longer holds. Pass the note's exact text from get_household. To change a rule instead, use add_household_note with replaces. Only the household's owner can change notes.",
  // A second call refuses, because the note is gone.
  annotations: { ...WRITE_ANNOTATIONS, destructiveHint: true, idempotentHint: false },
  inputSchema: z.object({
    note: z.string().trim().min(1).describe('The exact text of the note, from get_household.'),
  }),
  outputSchema: z.object({
    outcome: z.literal('removed'),
    removed: z.string().describe('The text of the note that was removed.'),
    notes: notesOutput,
  }),
  run: async (household, { note }, caller) => {
    const notes = await loadOwnerNotes(caller.userId)
    const result = removeNote(notes, note)
    if (result.status === 'no_match') throw noMatchError(notes)
    await updateHouseholdPreferences(household.id, { restrictions: result.notes })
    return { outcome: 'removed' as const, removed: note, notes: result.notes }
  },
})
