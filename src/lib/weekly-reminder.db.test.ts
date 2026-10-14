import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { saveReminder } from '@/lib/weekly-reminder'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks:
// rows are written with Prisma, changed through `saveReminder`, and read back.
// `weekly-reminder.test.ts` covers the send logic; the route test covers the
// confirm email and how the route maps these answers.

const SCHEDULE = {
  reminderWeekday: true,
  reminderConsentAt: true,
  reminderToken: true,
  reminderConfirmToken: true,
  reminderConfirmedAt: true,
  reminderLastSentAt: true,
} as const

/** An owner account `u-ada` in a household, with the reminder fields given. */
async function member(reminder: Record<string, unknown> = {}) {
  await prisma.user.create({ data: { id: 'u-ada', name: 'Ada', email: 'ada@example.com' } })
  await prisma.household.create({
    data: {
      name: 'Alder',
      members: { create: [{ id: 'm-ada', userId: 'u-ada', role: 'owner', ...reminder }] },
    },
  })
}

function schedule() {
  return prisma.householdMember.findUniqueOrThrow({ where: { id: 'm-ada' }, select: SCHEDULE })
}

describe('saveReminder', () => {
  it('opts in: writes the weekday, the consent time and both tokens', async () => {
    await member()
    const before = Date.now()

    const saved = await saveReminder('u-ada', 1)

    const stored = await schedule()
    expect(stored).toMatchObject({ reminderWeekday: 1, reminderConfirmedAt: null })
    expect(stored.reminderConsentAt!.getTime()).toBeGreaterThanOrEqual(before)
    expect(stored.reminderToken).toHaveLength(32)
    expect(stored.reminderConfirmToken).toHaveLength(32)
    // The address is not confirmed, so the confirm email is due (HON-1113).
    expect(saved).toEqual({ confirmToken: stored.reminderConfirmToken })
  })

  it('opts out: clears the weekday and the consent, keeping the tokens and the last send', async () => {
    const consent = new Date('2026-09-01T08:00:00Z')
    const lastSent = new Date('2026-10-05T08:00:00Z')
    await member({
      reminderWeekday: 3,
      reminderConsentAt: consent,
      reminderToken: 'stop-token',
      reminderConfirmToken: 'confirm-token',
      reminderConfirmedAt: consent,
      reminderLastSentAt: lastSent,
    })

    const saved = await saveReminder('u-ada', null)

    expect(saved).toEqual({ confirmToken: null })
    expect(await schedule()).toEqual({
      reminderWeekday: null,
      reminderConsentAt: null,
      reminderToken: 'stop-token',
      reminderConfirmToken: 'confirm-token',
      reminderConfirmedAt: consent,
      reminderLastSentAt: lastSent,
    })
  })

  it('moves the day without new consent and without a confirm email', async () => {
    const consent = new Date('2026-09-01T08:00:00Z')
    await member({
      reminderWeekday: 3,
      reminderConsentAt: consent,
      reminderToken: 'stop-token',
      reminderConfirmToken: 'confirm-token',
    })

    const saved = await saveReminder('u-ada', 5)

    expect(saved).toEqual({ confirmToken: null })
    expect(await schedule()).toMatchObject({
      reminderWeekday: 5,
      reminderConsentAt: consent,
      reminderToken: 'stop-token',
      reminderConfirmToken: 'confirm-token',
    })
  })

  it('reuses the stored confirm token when the reminder is switched on again', async () => {
    await member({ reminderToken: 'stop-token', reminderConfirmToken: 'confirm-token' })

    expect(await saveReminder('u-ada', 2)).toEqual({ confirmToken: 'confirm-token' })
    expect(await schedule()).toMatchObject({ reminderWeekday: 2, reminderToken: 'stop-token' })
  })

  it('asks for no confirm email when the address was confirmed before', async () => {
    await member({
      reminderToken: 'stop-token',
      reminderConfirmToken: 'confirm-token',
      reminderConfirmedAt: new Date('2026-09-01T08:00:00Z'),
    })

    expect(await saveReminder('u-ada', 2)).toEqual({ confirmToken: null })
    expect((await schedule()).reminderWeekday).toBe(2)
  })

  it('returns null and writes nothing for a user with no member row', async () => {
    await member()
    await prisma.user.create({ data: { id: 'u-solo', name: 'Solo', email: 'solo@example.com' } })

    expect(await saveReminder('u-solo', 1)).toBeNull()
    expect((await schedule()).reminderWeekday).toBeNull()
  })
})
