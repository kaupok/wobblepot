import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { prisma } from '@/lib/prisma'
import { isEmailConfigured } from '@/lib/resend'
import {
  deleteWaitlistRequest,
  discardWaitlistInviteCode,
  listConfirmedWaitlistRequests,
  markWaitlistInvited,
  prepareWaitlistInvite,
  processWaitlistRequest,
  WaitlistError,
  type WaitlistRefusal,
} from '@/lib/waitlist'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks.
// The email `processWaitlistRequest` sends is covered in `waitlist.test.ts`.

const NOW = new Date('2026-10-07T10:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

beforeAll(() => {
  // These cases call `processWaitlistRequest` for real, so a Resend key in the
  // environment would send real email. The test project sets none.
  expect(isEmailConfigured()).toBe(false)
})

beforeEach(() => {
  // `processWaitlistRequest` warns that email is not configured on every call.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

const createAdmin = () =>
  prisma.user.create({ data: { id: 'admin', name: 'Admin', email: 'admin@example.com' } })

/** A confirmed request from Anna, optionally linked to an earlier code. */
const confirmedRequest = (signupCodeId: string | null = null) =>
  prisma.waitlistRequest.create({
    data: {
      id: 'w1',
      email: 'anna@example.com',
      locale: 'et',
      confirmedAt: new Date('2026-10-05T12:00:00Z'),
      signupCodeId,
    },
  })

async function refusalOf(promise: Promise<unknown>): Promise<WaitlistRefusal> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof WaitlistError)) throw new Error(`Expected a refusal, got ${error}`)
  return error.reason
}

describe('deleteWaitlistRequest', () => {
  it('deletes the request and keeps its linked code', async () => {
    await prisma.signupCode.create({ data: { id: 'code_old', code: 'OLD' } })
    await confirmedRequest('code_old')

    await deleteWaitlistRequest('w1')

    expect(await prisma.waitlistRequest.count()).toBe(0)
    expect(await prisma.signupCode.count()).toBe(1)
  })

  it('refuses an unknown request', async () => {
    expect(await refusalOf(deleteWaitlistRequest('missing'))).toBe('notFound')
  })
})

describe('prepareWaitlistInvite', () => {
  it('mints a 14-day waitlist code for a confirmed request, without linking it yet', async () => {
    await createAdmin()
    await confirmedRequest()

    const invite = await prepareWaitlistInvite({ requestId: 'w1', createdById: 'admin', now: NOW })

    expect(invite).toMatchObject({
      email: 'anna@example.com',
      locale: 'et',
      previousCodeId: null,
    })
    expect(invite.code).toMatch(/^[\w-]{12}$/)
    const code = await prisma.signupCode.findUniqueOrThrow({ where: { id: invite.codeId } })
    expect(code).toMatchObject({
      code: invite.code,
      expiresAt: new Date(NOW.getTime() + 14 * DAY_MS),
      note: 'waitlist',
      createdById: 'admin',
      usedAt: null,
    })
    const request = await prisma.waitlistRequest.findUniqueOrThrow({ where: { id: 'w1' } })
    expect(request).toMatchObject({ signupCodeId: null, invitedAt: null })
  })

  it('returns the code linked before, for Send again', async () => {
    await createAdmin()
    await prisma.signupCode.create({ data: { id: 'code_old', code: 'OLD' } })
    await confirmedRequest('code_old')

    const invite = await prepareWaitlistInvite({ requestId: 'w1', createdById: 'admin', now: NOW })

    expect(invite.previousCodeId).toBe('code_old')
  })

  it('refuses an unconfirmed request and mints nothing', async () => {
    await createAdmin()
    await prisma.waitlistRequest.create({
      data: { id: 'w1', email: 'anna@example.com', locale: 'en' },
    })

    expect(
      await refusalOf(prepareWaitlistInvite({ requestId: 'w1', createdById: 'admin', now: NOW })),
    ).toBe('notFound')
    expect(await prisma.signupCode.count()).toBe(0)
  })

  it('refuses an unknown request', async () => {
    await createAdmin()

    expect(
      await refusalOf(
        prepareWaitlistInvite({ requestId: 'missing', createdById: 'admin', now: NOW }),
      ),
    ).toBe('notFound')
  })

  it('refuses an address that already has an account and mints nothing', async () => {
    await createAdmin()
    await confirmedRequest()
    await prisma.user.create({ data: { id: 'anna', name: 'Anna', email: 'anna@example.com' } })

    expect(
      await refusalOf(prepareWaitlistInvite({ requestId: 'w1', createdById: 'admin', now: NOW })),
    ).toBe('accountExists')
    expect(await prisma.signupCode.count()).toBe(0)
  })
})

describe('discardWaitlistInviteCode', () => {
  it('deletes the unsent code', async () => {
    await prisma.signupCode.create({ data: { id: 'code_new', code: 'NEW' } })

    await discardWaitlistInviteCode('code_new')

    expect(await prisma.signupCode.count()).toBe(0)
  })
})

describe('markWaitlistInvited', () => {
  it('marks the request invited and records the new code', async () => {
    await prisma.signupCode.create({ data: { id: 'code_new', code: 'NEW' } })
    await confirmedRequest()

    await markWaitlistInvited({
      requestId: 'w1',
      previousCodeId: null,
      codeId: 'code_new',
      now: NOW,
    })

    const request = await prisma.waitlistRequest.findUniqueOrThrow({ where: { id: 'w1' } })
    expect(request).toMatchObject({ invitedAt: NOW, signupCodeId: 'code_new' })
    const code = await prisma.signupCode.findUniqueOrThrow({ where: { id: 'code_new' } })
    expect(code.expiresAt).toBeNull()
  })

  it('expires the previous code on Send again while it is unused', async () => {
    await prisma.signupCode.create({ data: { id: 'code_old', code: 'OLD' } })
    await prisma.signupCode.create({ data: { id: 'code_new', code: 'NEW' } })
    await confirmedRequest('code_old')

    await markWaitlistInvited({
      requestId: 'w1',
      previousCodeId: 'code_old',
      codeId: 'code_new',
      now: NOW,
    })

    const old = await prisma.signupCode.findUniqueOrThrow({ where: { id: 'code_old' } })
    expect(old.expiresAt).toEqual(NOW)
    const request = await prisma.waitlistRequest.findUniqueOrThrow({ where: { id: 'w1' } })
    expect(request.signupCodeId).toBe('code_new')
  })

  it('leaves a previous code that was used meanwhile unexpired', async () => {
    await prisma.signupCode.create({ data: { id: 'code_old', code: 'OLD', usedAt: NOW } })
    await prisma.signupCode.create({ data: { id: 'code_new', code: 'NEW' } })
    await confirmedRequest('code_old')

    await markWaitlistInvited({
      requestId: 'w1',
      previousCodeId: 'code_old',
      codeId: 'code_new',
      now: NOW,
    })

    const old = await prisma.signupCode.findUniqueOrThrow({ where: { id: 'code_old' } })
    expect(old.expiresAt).toBeNull()
  })

  it('refuses when another send linked its code first, and expires only its own code', async () => {
    await prisma.signupCode.create({ data: { id: 'code_old', code: 'OLD' } })
    await prisma.signupCode.create({ data: { id: 'code_winner', code: 'WIN' } })
    await prisma.signupCode.create({ data: { id: 'code_new', code: 'NEW' } })
    // The winner replaced `code_old` between this send's read and its link.
    await confirmedRequest('code_winner')

    expect(
      await refusalOf(
        markWaitlistInvited({
          requestId: 'w1',
          previousCodeId: 'code_old',
          codeId: 'code_new',
          now: NOW,
        }),
      ),
    ).toBe('inviteConflict')

    const codes = await prisma.signupCode.findMany({ orderBy: { id: 'asc' } })
    expect(codes.map((c) => [c.id, c.expiresAt])).toEqual([
      ['code_new', NOW],
      ['code_old', null],
      ['code_winner', null],
    ])
    const request = await prisma.waitlistRequest.findUniqueOrThrow({ where: { id: 'w1' } })
    expect(request).toMatchObject({ signupCodeId: 'code_winner', invitedAt: null })
  })

  it('refuses when the request was deleted during the send, and expires the sent code', async () => {
    await prisma.signupCode.create({ data: { id: 'code_new', code: 'NEW' } })

    expect(
      await refusalOf(
        markWaitlistInvited({
          requestId: 'w1',
          previousCodeId: null,
          codeId: 'code_new',
          now: NOW,
        }),
      ),
    ).toBe('notFound')

    const code = await prisma.signupCode.findUniqueOrThrow({ where: { id: 'code_new' } })
    expect(code.expiresAt).toEqual(NOW)
  })
})

describe('listConfirmedWaitlistRequests', () => {
  it('lists confirmed requests only, newest confirmation first', async () => {
    await prisma.waitlistRequest.createMany({
      data: [
        {
          id: 'w2',
          email: 'ben@example.com',
          locale: 'en',
          confirmedAt: new Date('2026-10-04T12:00:00Z'),
        },
        {
          id: 'w1',
          email: 'anna@example.com',
          locale: 'et',
          source: 'mealime',
          confirmedAt: new Date('2026-10-05T12:00:00Z'),
          invitedAt: new Date('2026-10-06T08:00:00Z'),
        },
        { id: 'w3', email: 'cleo@example.com', locale: 'en' },
      ],
    })

    expect(await listConfirmedWaitlistRequests()).toEqual([
      {
        id: 'w1',
        email: 'anna@example.com',
        locale: 'et',
        source: 'mealime',
        confirmedAt: '2026-10-05T12:00:00.000Z',
        invitedAt: '2026-10-06T08:00:00.000Z',
      },
      {
        id: 'w2',
        email: 'ben@example.com',
        locale: 'en',
        source: null,
        confirmedAt: '2026-10-04T12:00:00.000Z',
        invitedAt: null,
      },
    ])
  })
})

describe('processWaitlistRequest', () => {
  const stored = (email: string) => prisma.waitlistRequest.findUnique({ where: { email } })

  it('stores a new address with its locale, source and a 32-character token', async () => {
    const before = Date.now()

    await processWaitlistRequest({ email: 'new@example.com', locale: 'et', source: 'mealime' })

    const row = await stored('new@example.com')
    expect(row).toMatchObject({
      locale: 'et',
      source: 'mealime',
      confirmedAt: null,
      invitedAt: null,
    })
    expect(row!.confirmToken).toMatch(/^[\w-]{32}$/)
    expect(row!.createdAt.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('reissues the token past the cooldown, and keeps the confirmation and the first source', async () => {
    const confirmedAt = new Date(Date.now() - DAY_MS)
    await prisma.waitlistRequest.create({
      data: {
        email: 'listed@example.com',
        locale: 'en',
        confirmToken: 'old-token',
        createdAt: new Date(Date.now() - 11 * MINUTE_MS),
        confirmedAt,
        source: 'facebook',
      },
    })

    await processWaitlistRequest({ email: 'listed@example.com', locale: 'et', source: 'reddit' })

    const row = await stored('listed@example.com')
    expect(row!.confirmToken).toMatch(/^[\w-]{32}$/)
    expect(row!.confirmToken).not.toBe('old-token')
    expect(row).toMatchObject({ locale: 'et', confirmedAt, source: 'facebook' })
    expect(Date.now() - row!.createdAt.getTime()).toBeLessThan(MINUTE_MS)
  })

  it('changes nothing for an address emailed less than 10 minutes ago', async () => {
    const createdAt = new Date(Date.now() - 9 * MINUTE_MS)
    await prisma.waitlistRequest.create({
      data: { email: 'victim@example.com', locale: 'en', confirmToken: 'live-token', createdAt },
    })

    await processWaitlistRequest({ email: 'victim@example.com', locale: 'et' })

    expect(await stored('victim@example.com')).toMatchObject({
      confirmToken: 'live-token',
      createdAt,
      locale: 'en',
    })
  })

  it('stores nothing for an address with an account', async () => {
    await prisma.user.create({ data: { id: 'm', name: 'M', email: 'member@example.com' } })

    await processWaitlistRequest({ email: 'member@example.com', locale: 'en' })

    expect(await prisma.waitlistRequest.count()).toBe(0)
  })
})
