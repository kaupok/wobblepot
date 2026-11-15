import { describe, expect, it } from 'vitest'

import { getHouseholdMembership } from '@/lib/household'
import { runTool, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { prisma } from '@/lib/prisma'
import { READ_SCOPES } from '@/test/mcp'

import { addHouseholdNote, FULL_MESSAGE } from './add-household-note'
import { getHousehold } from './get-household'
import { NOT_OWNER_MESSAGE } from './household-notes'
import { removeHouseholdNote } from './remove-household-note'

// Runs against PGlite through the `unit-db` project, with no mocks: the notes
// are written by the tools and read back from `household_preferences`.

const OWNER = { userId: 'u-owner' }
const MEMBER = { userId: 'u-member' }

/** A household with an owner and a member account, and the given notes. */
async function world(restrictions: string[] = []) {
  for (const id of [OWNER.userId, MEMBER.userId]) {
    await prisma.user.create({ data: { id, name: id, email: `${id}@example.com` } })
  }
  await prisma.household.create({
    data: {
      name: 'Alder',
      members: {
        create: [
          { userId: OWNER.userId, role: 'owner' },
          { userId: MEMBER.userId, role: 'member' },
        ],
      },
      preferences: { create: { restrictions } },
    },
  })
  return household(OWNER.userId)
}

async function household(userId: string) {
  const membership = await getHouseholdMembership(userId)
  if (!membership) throw new Error('no membership')
  return membership.household
}

async function storedNotes() {
  const row = await prisma.householdPreferences.findFirstOrThrow()
  return row.restrictions
}

function add(input: { note: string; replaces?: string }, caller = OWNER) {
  return household(caller.userId).then((h) =>
    addHouseholdNote.run(h, addHouseholdNote.inputSchema.parse(input), caller),
  )
}

function remove(note: string, caller = OWNER) {
  return household(caller.userId).then((h) =>
    removeHouseholdNote.run(h, removeHouseholdNote.inputSchema.parse({ note }), caller),
  )
}

const NOTES = ['Mild spice.', 'Office days need an easy dinner.', 'No mince two days in a row.']

describe('add_household_note', () => {
  it('appends a new note, and get_household returns it in restrictions', async () => {
    await world(['Mild spice.'])

    const result = await add({ note: '  Fish on Fridays. ' })

    expect(result).toEqual({ outcome: 'added', notes: ['Mild spice.', 'Fish on Fridays.'] })
    const read = await getHousehold.run(await household(OWNER.userId), {}, OWNER)
    expect(read.household.restrictions).toEqual(['Mild spice.', 'Fish on Fridays.'])
  })

  it('saves the first note of a household with no preferences row', async () => {
    await prisma.user.create({
      data: { id: OWNER.userId, name: 'owner', email: 'owner@example.com' },
    })
    await prisma.household.create({
      data: { name: 'Birch', members: { create: [{ userId: OWNER.userId, role: 'owner' }] } },
    })

    const result = await add({ note: 'Fish on Fridays.' })

    expect(result).toEqual({ outcome: 'added', notes: ['Fish on Fridays.'] })
    expect(await storedNotes()).toEqual(['Fish on Fridays.'])
  })

  it('replaces a note in place and keeps the order of the others', async () => {
    await world(NOTES)

    const result = await add({
      note: 'Office days need a 20-minute dinner.',
      replaces: 'Office days need an easy dinner.',
    })

    const expected = [
      'Mild spice.',
      'Office days need a 20-minute dinner.',
      'No mince two days in a row.',
    ]
    expect(result).toEqual({ outcome: 'replaced', notes: expected })
    expect(await storedNotes()).toEqual(expected)
  })

  it('returns unchanged for a note already in the list, and writes nothing', async () => {
    await world(['  Mild spice. ', 'Fish on Fridays.'])

    const result = await add({ note: 'MILD SPICE.' })

    expect(result).toEqual({ outcome: 'unchanged', notes: ['  Mild spice. ', 'Fish on Fridays.'] })
    expect(await storedNotes()).toEqual(['  Mild spice. ', 'Fish on Fridays.'])
  })

  it('keeps both notes when two adds run at once', async () => {
    await world(['Mild spice.'])

    await Promise.all([add({ note: 'Fish on Fridays.' }), add({ note: 'No mince on Mondays.' })])

    expect((await storedNotes()).sort()).toEqual([
      'Fish on Fridays.',
      'Mild spice.',
      'No mince on Mondays.',
    ])
  })

  it('refuses an add to a list of 30 notes, and the list stays', async () => {
    const full = Array.from({ length: 30 }, (_, i) => `Note ${i + 1}.`)
    await world(full)

    await expect(add({ note: 'Fish on Fridays.' })).rejects.toThrow(FULL_MESSAGE)
    expect(await storedNotes()).toEqual(full)
  })

  it('refuses a replaces that matches no note, and the error lists the notes', async () => {
    await world(NOTES)

    await expect(add({ note: 'Fish on Fridays.', replaces: 'Spicy food.' })).rejects.toThrow(
      'No note has exactly this text. The current notes are: ["Mild spice.","Office days need an easy dinner.","No mince two days in a row."]. Copy a note\'s text exactly. Nothing was changed.',
    )
    expect(await storedNotes()).toEqual(NOTES)
  })

  it('refuses a note with a line break', () => {
    expect(addHouseholdNote.inputSchema.safeParse({ note: 'One.\nTwo.' }).success).toBe(false)
  })

  it('refuses a member who is not the owner, and writes nothing', async () => {
    await world(NOTES)

    await expect(add({ note: 'Fish on Fridays.' }, MEMBER)).rejects.toThrow(NOT_OWNER_MESSAGE)
    expect(await storedNotes()).toEqual(NOTES)
  })

  it('answers a read-only token with the reconnect message, and writes nothing', async () => {
    const h = await world(NOTES)

    const result = await runTool(
      addHouseholdNote,
      { userId: OWNER.userId, household: h, scopes: READ_SCOPES },
      { note: 'Fish on Fridays.' },
    )

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: WRITE_SCOPE_MESSAGE }],
    })
    expect(await storedNotes()).toEqual(NOTES)
  })
})

describe('remove_household_note', () => {
  it('removes exactly the named note', async () => {
    await world(NOTES)

    const result = await remove('Office days need an easy dinner.')

    const expected = ['Mild spice.', 'No mince two days in a row.']
    expect(result).toEqual({
      outcome: 'removed',
      removed: 'Office days need an easy dinner.',
      notes: expected,
    })
    expect(await storedNotes()).toEqual(expected)
  })

  it('refuses a note that matches none, and the error lists the notes', async () => {
    await world(['Mild spice.'])

    await expect(remove('Spicy food.')).rejects.toThrow(
      'No note has exactly this text. The current notes are: ["Mild spice."].',
    )
    expect(await storedNotes()).toEqual(['Mild spice.'])
  })

  it('says the household has no notes when the list is empty', async () => {
    await world()

    await expect(remove('Mild spice.')).rejects.toThrow('The household has no notes yet.')
  })

  it('refuses a member who is not the owner, and writes nothing', async () => {
    await world(NOTES)

    await expect(remove('Mild spice.', MEMBER)).rejects.toThrow(NOT_OWNER_MESSAGE)
    expect(await storedNotes()).toEqual(NOTES)
  })

  it('answers a read-only token with the reconnect message, and writes nothing', async () => {
    const h = await world(NOTES)

    const result = await runTool(
      removeHouseholdNote,
      { userId: OWNER.userId, household: h, scopes: READ_SCOPES },
      { note: 'Mild spice.' },
    )

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: WRITE_SCOPE_MESSAGE }],
    })
    expect(await storedNotes()).toEqual(NOTES)
  })
})
