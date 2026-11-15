/**
 * The household's "Notes for the AI" (`HouseholdPreferences.restrictions`, one
 * note per line on Household → Meal preferences) as a list an assistant edits
 * one note at a time (HON-1651). Pure, so the MCP tools own the owner check
 * and the write.
 */

/**
 * Most notes an assistant may grow the list to. The notes go into four AI
 * prompts (`src/lib/ai/prompts.ts`), so the list must not grow without limit.
 * The form is not bound by it: an owner who types more keeps them.
 */
export const MAX_HOUSEHOLD_NOTES = 30

export type AddNoteResult =
  { status: 'added' | 'replaced'; notes: string[] } | { status: 'unchanged' | 'no_match' | 'full' }

export type RemoveNoteResult = { status: 'removed'; notes: string[] } | { status: 'no_match' }

/**
 * The note whose text, trimmed, is exactly `text`. The tools trim their input,
 * and the preferences route stores a note as sent, so an untrimmed stored note
 * must still be reachable.
 */
function indexOfNote(notes: readonly string[], text: string) {
  return notes.findIndex((existing) => existing.trim() === text)
}

function sameNote(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * Appends `note`, or puts it in the place of the note whose trimmed text is
 * exactly `replaces`. A note already in the list (trimmed, case-insensitive) is
 * `unchanged`; the note being replaced does not count, so a replace can fix
 * only the case. A replace whose note is already another note in the list
 * drops the replaced one, so the retired rule leaves the prompts.
 */
export function addNote(notes: readonly string[], note: string, replaces?: string): AddNoteResult {
  const index = replaces === undefined ? -1 : indexOfNote(notes, replaces)
  if (replaces !== undefined && index === -1) return { status: 'no_match' }

  if (notes.some((existing, i) => i !== index && sameNote(existing, note))) {
    if (index === -1) return { status: 'unchanged' }
    return { status: 'replaced', notes: notes.filter((_, i) => i !== index) }
  }

  if (index === -1) {
    if (notes.length >= MAX_HOUSEHOLD_NOTES) return { status: 'full' }
    return { status: 'added', notes: [...notes, note] }
  }

  if (notes[index] === note) return { status: 'unchanged' }
  return { status: 'replaced', notes: notes.map((existing, i) => (i === index ? note : existing)) }
}

/** Removes the note whose trimmed text is exactly `note`. */
export function removeNote(notes: readonly string[], note: string): RemoveNoteResult {
  const index = indexOfNote(notes, note)
  if (index === -1) return { status: 'no_match' }
  return { status: 'removed', notes: notes.filter((_, i) => i !== index) }
}
