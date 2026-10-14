import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { AccountDeletionError, requestAccountDeletion } from '@/lib/auth/account'
import { assertUserNotSoftDeleted } from '@/lib/auth/soft-delete-guard'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks.

const DAY_MS = 24 * 60 * 60 * 1000

/** A user with a password, a session, a connected app and an API key. */
async function accountHolder(id: string) {
  await prisma.user.create({ data: { id, name: id, email: `${id}@example.com` } })
  await prisma.account.create({
    data: {
      id: `account-${id}`,
      accountId: id,
      providerId: 'credential',
      userId: id,
      password: 'hash',
    },
  })
  await prisma.session.create({
    data: {
      id: `session-${id}`,
      token: `token-${id}`,
      userId: id,
      expiresAt: new Date(Date.now() + DAY_MS),
    },
  })
  await prisma.oauthRefreshToken.create({
    data: { id: `refresh-${id}`, token: `refresh-${id}`, clientId: 'client-claude', userId: id },
  })
  await prisma.oauthAccessToken.create({
    data: { id: `access-${id}`, token: `access-${id}`, clientId: 'client-claude', userId: id },
  })
  await prisma.oauthConsent.create({
    data: { id: `consent-${id}`, clientId: 'client-claude', userId: id, scopes: ['openid'] },
  })
  await prisma.apiKey.create({
    data: { userId: id, name: 'Shortcut', start: 'wp_', hash: `hash-${id}` },
  })
}

/**
 * Ann owns Alder alone with a manual member (a child, no account). Bob owns
 * Birch with Cy, who has an account. Each has the full set of grants.
 */
async function world() {
  await prisma.oauthClient.create({
    data: { id: 'oauth-claude', clientId: 'client-claude', name: 'Claude' },
  })
  for (const id of ['ann', 'bob', 'cy']) await accountHolder(id)
  await prisma.household.create({
    data: {
      name: 'Alder',
      members: {
        create: [
          { userId: 'ann', role: 'owner' },
          { name: 'Kid', role: 'member' },
        ],
      },
    },
  })
  const birch = await prisma.household.create({
    data: {
      name: 'Birch',
      members: {
        create: [
          { userId: 'bob', role: 'owner' },
          { userId: 'cy', role: 'member' },
        ],
      },
    },
  })
  return { birch: birch.id }
}

/** How many rows of each grant the user still has. */
async function grants(userId: string) {
  const where = { where: { userId } }
  return {
    accounts: await prisma.account.count(where),
    sessions: await prisma.session.count(where),
    refreshTokens: await prisma.oauthRefreshToken.count(where),
    accessTokens: await prisma.oauthAccessToken.count(where),
    consents: await prisma.oauthConsent.count(where),
    apiKeys: await prisma.apiKey.count(where),
  }
}

const deletionColumns = (id: string) =>
  prisma.user.findUniqueOrThrow({
    where: { id },
    select: { deletedAt: true, purgeScheduledFor: true },
  })

describe('requestAccountDeletion', () => {
  it('marks the user with the request time and the first 03:00 UTC run after 30 days', async () => {
    await world()
    const now = new Date('2026-10-15T10:00:00.000Z')

    const { purgeScheduledFor } = await requestAccountDeletion('ann', now)

    expect(purgeScheduledFor).toEqual(new Date('2026-11-15T03:00:00.000Z'))
    expect(await deletionColumns('ann')).toEqual({
      deletedAt: now,
      purgeScheduledFor: new Date('2026-11-15T03:00:00.000Z'),
    })
  })

  it('never purges before the full 30 days, even when the request lands before 03:00', async () => {
    await world()
    const now = new Date('2026-10-15T02:59:00.000Z')

    const { purgeScheduledFor } = await requestAccountDeletion('ann', now)

    expect(purgeScheduledFor).toEqual(new Date('2026-11-14T03:00:00.000Z'))
    expect(purgeScheduledFor.getTime() - now.getTime()).toBeGreaterThanOrEqual(30 * DAY_MS)
  })

  it('signs the user out, revokes connected apps and API keys, and keeps the password', async () => {
    await world()

    await requestAccountDeletion('ann')

    expect(await grants('ann')).toEqual({
      accounts: 1,
      sessions: 0,
      refreshTokens: 0,
      accessTokens: 0,
      consents: 0,
      apiKeys: 0,
    })
  })

  it("leaves the household and another user's grants alone", async () => {
    await world()

    await requestAccountDeletion('ann')

    expect(await prisma.household.count({ where: { name: 'Alder' } })).toBe(1)
    expect(await prisma.householdMember.count({ where: { household: { name: 'Alder' } } })).toBe(2)
    expect(await grants('bob')).toEqual({
      accounts: 1,
      sessions: 1,
      refreshTokens: 1,
      accessTokens: 1,
      consents: 1,
      apiKeys: 1,
    })
    expect(await deletionColumns('bob')).toEqual({ deletedAt: null, purgeScheduledFor: null })
  })

  it('lets a non-owner member of a shared household delete', async () => {
    await world()

    await requestAccountDeletion('cy')

    expect((await deletionColumns('cy')).deletedAt).not.toBeNull()
  })

  it('refuses the sole owner of a household where another member has an account, and changes nothing', async () => {
    const { birch } = await world()

    const error = await requestAccountDeletion('bob').then(
      () => null,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(AccountDeletionError)
    expect(error).toMatchObject({
      reason: 'soleOwner',
      household: { id: birch, name: 'Birch', otherMemberCount: 1 },
    })
    expect(await deletionColumns('bob')).toEqual({ deletedAt: null, purgeScheduledFor: null })
    expect((await grants('bob')).sessions).toBe(1)
  })

  it('is reversed by the runbook recovery SQL, after which sign-in is allowed again', async () => {
    await world()
    await requestAccountDeletion('ann')
    await expect(assertUserNotSoftDeleted('ann')).rejects.toThrow()

    // Verbatim from docs/RUNBOOKS/gdpr-deletion.md → Recovery procedure.
    const restored = await prisma.$executeRaw`
      UPDATE "user"
      SET "deletedAt" = NULL,
          "purgeScheduledFor" = NULL
      WHERE email = 'ann@example.com'
        AND "deletedAt" IS NOT NULL`

    expect(restored).toBe(1)
    expect(await deletionColumns('ann')).toEqual({ deletedAt: null, purgeScheduledFor: null })
    await expect(assertUserNotSoftDeleted('ann')).resolves.toBeUndefined()
  })
})
