import { describe, expect, it } from 'vitest'

import { addNote, removeNote } from './notes'

const NOTES = ['Mild spice.', 'Office days need an easy dinner.', 'No mince two days in a row.']

describe('addNote', () => {
  it('appends a new note', () => {
    expect(addNote(NOTES, 'Fish on Fridays.')).toEqual({
      status: 'added',
      notes: [
        'Mild spice.',
        'Office days need an easy dinner.',
        'No mince two days in a row.',
        'Fish on Fridays.',
      ],
    })
  })

  it('puts a replacement in the place of the note it replaces', () => {
    expect(
      addNote(NOTES, 'Office days need a 20-minute dinner.', 'Office days need an easy dinner.'),
    ).toEqual({
      status: 'replaced',
      notes: ['Mild spice.', 'Office days need a 20-minute dinner.', 'No mince two days in a row.'],
    })
  })

  it('lets a replacement change only the case of the note it replaces', () => {
    expect(addNote(NOTES, 'mild spice.', 'Mild spice.')).toEqual({
      status: 'replaced',
      notes: ['mild spice.', 'Office days need an easy dinner.', 'No mince two days in a row.'],
    })
  })

  it('is unchanged for a note already in the list, whatever the case and spaces', () => {
    expect(addNote(NOTES, 'office days NEED an easy dinner.')).toEqual({ status: 'unchanged' })
    expect(addNote(['  Mild spice. '], 'Mild spice.')).toEqual({ status: 'unchanged' })
  })

  it('drops the replaced note when the replacement repeats another note', () => {
    expect(addNote(['Mild spice.', 'Medium spice.'], 'mild spice.', 'Medium spice.')).toEqual({
      status: 'replaced',
      notes: ['Mild spice.'],
    })
  })

  it('replaces a stored note with spaces around it', () => {
    expect(addNote(['  Mild spice. '], 'Medium spice.', 'Mild spice.')).toEqual({
      status: 'replaced',
      notes: ['Medium spice.'],
    })
  })

  it('is no_match when replaces is not the exact text of a note', () => {
    expect(addNote(NOTES, 'Fish on Fridays.', 'mild spice')).toEqual({ status: 'no_match' })
  })

  it('refuses an add to a list of 30 notes, but still replaces in it', () => {
    const full = Array.from({ length: 30 }, (_, i) => `Note ${i + 1}.`)

    expect(addNote(full, 'Fish on Fridays.')).toEqual({ status: 'full' })
    const replaced = addNote(full, 'Fish on Fridays.', 'Note 30.')
    expect(replaced.status).toBe('replaced')
    expect('notes' in replaced && replaced.notes.at(-1)).toBe('Fish on Fridays.')
  })
})

describe('removeNote', () => {
  it('removes exactly the named note', () => {
    expect(removeNote(NOTES, 'Office days need an easy dinner.')).toEqual({
      status: 'removed',
      notes: ['Mild spice.', 'No mince two days in a row.'],
    })
  })

  it('removes a stored note with spaces around it', () => {
    expect(removeNote(['  Mild spice. ', 'Fish on Fridays.'], 'Mild spice.')).toEqual({
      status: 'removed',
      notes: ['Fish on Fridays.'],
    })
  })

  it('is no_match for a text that is not exactly a note', () => {
    expect(removeNote(NOTES, 'office days need an easy dinner.')).toEqual({ status: 'no_match' })
  })
})
