import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { clearReminderConfirmation, isWeekPlanned, saveReminder } from '@/lib/weekly-reminder'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks:
// rows are written with Prisma, changed through `saveReminder`, and read back,
// or read through `isWeekPlanned`.
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

describe('clearReminderConfirmation', () => {
  const now = new Date('2026-10-21T08:00:00Z')

  it('clears a reminder that is on, with a new confirm token and consent time', async () => {
    await member({
      reminderWeekday: 5,
      reminderConsentAt: new Date('2026-10-01T08:00:00Z'),
      reminderToken: 'stop-token',
      reminderConfirmToken: 'old-confirm-token',
      reminderConfirmedAt: new Date('2026-10-02T08:00:00Z'),
    })

    const { confirmToken } = await clearReminderConfirmation('u-ada', now)

    expect(confirmToken).toMatch(/^[\w-]{32}$/)
    expect(confirmToken).not.toBe('old-confirm-token')
    expect(await schedule()).toEqual({
      reminderWeekday: 5,
      reminderConsentAt: now,
      reminderToken: 'stop-token',
      reminderConfirmToken: confirmToken,
      reminderConfirmedAt: null,
      reminderLastSentAt: null,
    })
  })

  it('clears a reminder that is off and leaves it without a confirm token', async () => {
    await member({
      reminderToken: 'stop-token',
      reminderConfirmToken: 'old-confirm-token',
      reminderConfirmedAt: new Date('2026-10-02T08:00:00Z'),
    })

    expect(await clearReminderConfirmation('u-ada', now)).toEqual({ confirmToken: null })
    expect(await schedule()).toEqual({
      reminderWeekday: null,
      reminderConsentAt: null,
      reminderToken: 'stop-token',
      reminderConfirmToken: null,
      reminderConfirmedAt: null,
      reminderLastSentAt: null,
    })
  })

  it('does nothing for a user without a member row', async () => {
    expect(await clearReminderConfirmation('u-nobody', now)).toEqual({ confirmToken: null })
  })
})

describe('isWeekPlanned', () => {
  const START = new Date('2026-10-19T00:00:00Z')
  const END = new Date('2026-10-26T00:00:00Z')

  /** Alder and Birch, each with a plan, and a stew Alder can plan. */
  async function plans() {
    await prisma.household.create({
      data: { id: 'h-alder', name: 'Alder', mealPlans: { create: { id: 'plan-alder' } } },
    })
    await prisma.household.create({
      data: { id: 'h-birch', name: 'Birch', mealPlans: { create: { id: 'plan-birch' } } },
    })
    await prisma.meal.create({ data: { id: 'meal-stew', name: 'Stew' } })
  }

  function entry(data: { planId?: string; mealId?: string; note?: string; date?: string }) {
    const { date = '2026-10-21T00:00:00Z', planId = 'plan-alder', ...rest } = data
    return prisma.mealPlanEntry.create({
      data: { planId, date: new Date(date), mealType: 'dinner', ...rest },
    })
  }

  it('is false when the only entry is a placeholder with no meal and no note, so the reminder goes out', async () => {
    await plans()
    await entry({})

    expect(await isWeekPlanned('h-alder', START, END)).toBe(false)
  })

  it('is true for an entry with a meal', async () => {
    await plans()
    await entry({ mealId: 'meal-stew' })

    expect(await isWeekPlanned('h-alder', START, END)).toBe(true)
  })

  it('is true for a note-only entry', async () => {
    await plans()
    await entry({ note: 'Leftovers' })

    expect(await isWeekPlanned('h-alder', START, END)).toBe(true)
  })

  it('is false for a meal outside the week or in another household', async () => {
    await plans()
    await entry({ mealId: 'meal-stew', date: '2026-10-26T00:00:00Z' })
    await entry({ mealId: 'meal-stew', date: '2026-10-18T00:00:00Z' })
    await entry({ planId: 'plan-birch', mealId: 'meal-stew' })

    expect(await isWeekPlanned('h-alder', START, END)).toBe(false)
  })
})
