import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getServerBaseURL } from '@/lib/env'
import {
  createHouseholdInvite,
  findHouseholdInvite,
  HouseholdInviteError,
  listHouseholdInvites,
  revokeHouseholdInvite,
  type HouseholdInviteRefusal,
} from '@/lib/household-invite'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks:
// rows are written with Prisma, then read back after each call.

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Alder, with an owner, a member without an account and one with an account,
 * and Birch, with a member without an account of its own.
 */
async function world() {
  await prisma.user.create({ data: { id: 'u-owner', name: 'Owner', email: 'owner@example.com' } })
  await prisma.user.create({ data: { id: 'u-kid', name: 'Kid', email: 'kid@example.com' } })
  const alder = await prisma.household.create({
    data: {
      name: 'Alder',
      members: {
        create: [
          { id: 'm-owner', name: 'Owner', role: 'owner', userId: 'u-owner' },
          { id: 'm-partner', name: 'Partner' },
          { id: 'm-kid', name: 'Kid', userId: 'u-kid' },
        ],
      },
    },
  })
  const birch = await prisma.household.create({
    data: { name: 'Birch', members: { create: [{ id: 'm-birch', name: 'Neighbour' }] } },
  })
  return {
    owner: { householdId: alder.id, role: 'owner' },
    member: { householdId: alder.id, role: 'member' },
    birchOwner: { householdId: birch.id, role: 'owner' },
  }
}

async function refusalOf(promise: Promise<unknown>): Promise<HouseholdInviteRefusal> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof HouseholdInviteError)) throw new Error(`Expected a refusal, got ${error}`)
  return error.reason
}

describe('createHouseholdInvite', () => {
  it('stores an invite for a member without an account and returns its link', async () => {
    const { owner } = await world()
    const before = Date.now()

    const invite = await createHouseholdInvite(owner, 'm-partner', 7)

    expect(invite.code).toMatch(/^[\w-]{12}$/)
    expect(invite.url).toBe(`${getServerBaseURL()}/invite/${invite.code}`)
    expect(invite).toMatchObject({ memberId: 'm-partner', memberName: 'Partner' })
    const row = await prisma.householdInvite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(row).toMatchObject({
      householdId: owner.householdId,
      memberId: 'm-partner',
      code: invite.code,
    })
    expect(row.expiresAt.toISOString()).toBe(invite.expiresAt)
    // Seven days out, give or take the test's own run time.
    expect(row.expiresAt.getTime() - before).toBeGreaterThanOrEqual(7 * DAY_MS - 1000)
    expect(row.expiresAt.getTime() - before).toBeLessThan(7 * DAY_MS + 60_000)
  })

  it("replaces the member's earlier invite instead of adding a second", async () => {
    const { owner } = await world()

    const first = await createHouseholdInvite(owner, 'm-partner', 7)
    const second = await createHouseholdInvite(owner, 'm-partner', 1)

    expect(second.id).toBe(first.id)
    expect(second.code).not.toBe(first.code)
    const rows = await prisma.householdInvite.findMany({ where: { memberId: 'm-partner' } })
    expect(rows.map((row) => row.code)).toEqual([second.code])
  })

  it('refuses a member who is not the owner, and writes nothing', async () => {
    const { member } = await world()

    expect(await refusalOf(createHouseholdInvite(member, 'm-partner', 7))).toBe('notOwner')
    expect(await prisma.householdInvite.count()).toBe(0)
  })

  it("answers memberNotFound for another household's member", async () => {
    const { owner } = await world()

    expect(await refusalOf(createHouseholdInvite(owner, 'm-birch', 7))).toBe('memberNotFound')
    expect(await refusalOf(createHouseholdInvite(owner, 'm-nobody', 7))).toBe('memberNotFound')
    expect(await prisma.householdInvite.count()).toBe(0)
  })

  it('refuses a member who already has an account', async () => {
    const { owner } = await world()

    expect(await refusalOf(createHouseholdInvite(owner, 'm-kid', 7))).toBe('memberClaimed')
    expect(await prisma.householdInvite.count()).toBe(0)
  })
})

describe('listHouseholdInvites', () => {
  it("lists only the household's invites, newest first, with whether each still works", async () => {
    const { owner, birchOwner } = await world()
    const now = new Date('2026-10-15T12:00:00Z')
    await prisma.householdInvite.create({
      data: {
        id: 'inv-old',
        householdId: owner.householdId,
        memberId: 'm-partner',
        code: 'old-code',
        expiresAt: new Date('2026-10-14T12:00:00Z'),
        createdAt: new Date('2026-10-07T12:00:00Z'),
      },
    })
    await prisma.householdInvite.create({
      data: {
        id: 'inv-new',
        householdId: owner.householdId,
        code: 'new-code',
        expiresAt: new Date('2026-10-20T12:00:00Z'),
        createdAt: new Date('2026-10-13T12:00:00Z'),
      },
    })
    await prisma.householdInvite.create({
      data: {
        householdId: birchOwner.householdId,
        memberId: 'm-birch',
        code: 'birch-code',
        expiresAt: new Date('2026-10-20T12:00:00Z'),
      },
    })

    expect(await listHouseholdInvites(owner, now)).toEqual([
      {
        id: 'inv-new',
        code: 'new-code',
        url: `${getServerBaseURL()}/invite/new-code`,
        memberId: null,
        memberName: null,
        expiresAt: '2026-10-20T12:00:00.000Z',
        isActive: true,
        createdAt: '2026-10-13T12:00:00.000Z',
      },
      {
        id: 'inv-old',
        code: 'old-code',
        url: `${getServerBaseURL()}/invite/old-code`,
        memberId: 'm-partner',
        memberName: 'Partner',
        expiresAt: '2026-10-14T12:00:00.000Z',
        isActive: false,
        createdAt: '2026-10-07T12:00:00.000Z',
      },
    ])
  })

  it('refuses a member who is not the owner', async () => {
    const { member } = await world()

    expect(await refusalOf(listHouseholdInvites(member))).toBe('notOwner')
  })
})

describe('revokeHouseholdInvite', () => {
  it('deletes the invite', async () => {
    const { owner } = await world()
    const invite = await createHouseholdInvite(owner, 'm-partner', 7)

    await revokeHouseholdInvite(owner, invite.id)

    expect(await prisma.householdInvite.findUnique({ where: { id: invite.id } })).toBeNull()
    expect(await findHouseholdInvite(invite.code)).toBeNull()
  })

  it("answers inviteNotFound for another household's invite, and leaves it", async () => {
    const { owner, birchOwner } = await world()
    const birchInvite = await createHouseholdInvite(birchOwner, 'm-birch', 7)

    expect(await refusalOf(revokeHouseholdInvite(owner, birchInvite.id))).toBe('inviteNotFound')
    expect(await prisma.householdInvite.count({ where: { id: birchInvite.id } })).toBe(1)
  })

  it('answers inviteNotFound for an invite that no longer exists', async () => {
    const { owner } = await world()

    expect(await refusalOf(revokeHouseholdInvite(owner, 'inv-gone'))).toBe('inviteNotFound')
  })

  it('refuses a member who is not the owner, and leaves the invite', async () => {
    const { owner, member } = await world()
    const invite = await createHouseholdInvite(owner, 'm-partner', 7)

    expect(await refusalOf(revokeHouseholdInvite(member, invite.id))).toBe('notOwner')
    expect(await prisma.householdInvite.count({ where: { id: invite.id } })).toBe(1)
  })
})

describe('findHouseholdInvite', () => {
  it("reads whether the owner's account is pending deletion with the invite (HON-881)", async () => {
    const { owner } = await world()
    const { code } = await createHouseholdInvite(owner, 'm-partner', 7)

    expect((await findHouseholdInvite(code))?.household.members).toEqual([])

    await prisma.user.update({ where: { id: 'u-owner' }, data: { deletedAt: new Date() } })

    expect((await findHouseholdInvite(code))?.household.members).toEqual([{ id: 'm-owner' }])
  })
})
