import 'server-only'

import { z } from 'zod'

import { addNote, MAX_HOUSEHOLD_NOTES } from '@/lib/household/notes'
import { editHouseholdNotes } from '@/lib/household/preferences'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'

import { noMatchError, notesOutput, noteText, requireOwner } from './household-notes'

export const FULL_MESSAGE = `The household already has ${MAX_HOUSEHOLD_NOTES} household notes, the most an assistant may save. Replace a note (pass replaces) or remove one with remove_household_note first. Nothing was changed.`

export const addHouseholdNote = defineTool({
  name: 'add_household_note',
  title: 'Save a household note',
  description:
    'Saves a lasting rule in the "Household notes" (restrictions in get_household), which the household sees and edits on Household → Meal preferences. Wobblepot\'s AI reads these notes when it generates a plan, imagines a meal, adjusts a recipe or answers a cooking question. Save a note only when the user states a rule that holds from now on ("office days need an easy dinner") or agrees when you ask whether to remember it; a wish for one meal or one week is not a note. Write it as one short sentence in the household\'s language. Allergens and ingredients to avoid are not notes, because nothing enforces a note: ask the user to set them on Household → Meal preferences. To change a rule, pass the old note\'s exact text as replaces, so the note keeps its place. Only the household\'s owner can change notes.',
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false },
  inputSchema: z.object({
    note: noteText.describe('The rule as one short sentence, at most 200 characters.'),
    replaces: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'The exact text of the note this one replaces, from get_household. Leave out to add.',
      ),
  }),
  outputSchema: z.object({
    outcome: z
      .enum(['added', 'replaced', 'unchanged'])
      .describe(
        'added: the note is now last in the list. replaced: the note took the place of replaces, or replaces was removed because the list already had the note. unchanged: the list already had this note, so nothing was saved.',
      ),
    notes: notesOutput,
  }),
  run: async (household, { note, replaces }, caller) => {
    await requireOwner(caller.userId)
    const { before, result } = await editHouseholdNotes(household.id, (notes) =>
      addNote(notes, note, replaces),
    )
    switch (result.status) {
      case 'no_match':
        throw noMatchError(before)
      case 'full':
        throw new ToolInputError(FULL_MESSAGE)
      case 'unchanged':
        return { outcome: 'unchanged' as const, notes: before }
      default:
        return { outcome: result.status, notes: result.notes }
    }
  },
})
