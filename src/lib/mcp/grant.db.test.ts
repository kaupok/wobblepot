import { describe, expect, it } from 'vitest'

import { loadMcpCaller, McpGrantError, type McpGrantRefusal } from '@/lib/mcp/grant'
import { prisma } from '@/lib/prisma'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks.

/** The consent row's `createdAt`, whole seconds as the plugin writes it. */
const GRANTED_AT = new Date('2026-10-12T12:00:00Z')
const GRANTED_IAT = GRANTED_AT.getTime() / 1000
const SCOPES = ['openid', 'mcp:read'] as const

/** Ann in household Alder, with client-1 allowed at {@link GRANTED_AT}. */
async function world({ deletedAt = null }: { deletedAt?: Date | null } = {}) {
  await prisma.user.create({
    data: { id: 'ann', name: 'Ann', email: 'ann@example.com', deletedAt },
  })
  const household = await prisma.household.create({ data: { name: 'Alder' } })
  await prisma.householdMember.create({
    data: { householdId: household.id, userId: 'ann', role: 'owner' },
  })
  await prisma.oauthClient.create({ data: { id: 'oc-1', clientId: 'client-1' } })
  await prisma.oauthConsent.create({
    data: { id: 'consent-1', clientId: 'client-1', userId: 'ann', createdAt: GRANTED_AT },
  })
  return { householdId: household.id }
}

const load = (overrides: Partial<Parameters<typeof loadMcpCaller>[0]> = {}) =>
  loadMcpCaller({
    userId: 'ann',
    clientId: 'client-1',
    issuedAt: GRANTED_IAT + 10,
    scopes: SCOPES,
    ...overrides,
  })

async function refusalOf(promise: Promise<unknown>): Promise<McpGrantRefusal> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof McpGrantError)) throw new Error(`Expected a refusal, got ${error}`)
  return error.reason
}

describe('loadMcpCaller', () => {
  it("returns the caller with their household and the token's scopes", async () => {
    const { householdId } = await world()

    const caller = await load()

    expect(caller.userId).toBe('ann')
    expect(caller.scopes).toEqual(SCOPES)
    expect(caller.household?.id).toBe(householdId)
    expect(caller.household?.name).toBe('Alder')
  })

  it('returns a null household for an account that has not finished onboarding', async () => {
    await world()
    await prisma.householdMember.deleteMany({ where: { userId: 'ann' } })

    expect((await load()).household).toBeNull()
  })

  it('refuses the token of a deleted account', async () => {
    await world({ deletedAt: new Date() })

    expect(await refusalOf(load())).toBe('noAccount')
  })

  it('refuses the token of a user who no longer exists', async () => {
    await world()

    expect(await refusalOf(load({ userId: 'ghost' }))).toBe('noAccount')
  })

  it('refuses the token of a disconnected client (HON-1153)', async () => {
    await world()
    await prisma.oauthConsent.deleteMany()

    expect(await refusalOf(load())).toBe('noGrant')
  })

  it('refuses a token for a client the user never allowed', async () => {
    await world()
    await prisma.oauthClient.create({ data: { id: 'oc-2', clientId: 'client-2' } })

    expect(await refusalOf(load({ clientId: 'client-2' }))).toBe('noGrant')
  })

  it('refuses a token issued before a Disconnect and reconnect', async () => {
    await world()
    // The reconnect wrote a new consent row a minute after this token's `iat`.
    await prisma.oauthConsent.deleteMany()
    await prisma.oauthConsent.create({
      data: {
        id: 'consent-2',
        clientId: 'client-1',
        userId: 'ann',
        createdAt: new Date((GRANTED_IAT + 70) * 1000),
      },
    })

    expect(await refusalOf(load())).toBe('noGrant')
  })

  it('accepts a token issued in the same second as its consent row', async () => {
    await world()

    await expect(load({ issuedAt: GRANTED_IAT })).resolves.toMatchObject({ userId: 'ann' })
  })

  it('treats a token without iat as issued at the epoch', async () => {
    await world()

    expect(await refusalOf(load({ issuedAt: undefined }))).toBe('noGrant')
  })

  it('checks against the earliest consent row when the client has several', async () => {
    await world()
    await prisma.oauthConsent.create({
      data: {
        id: 'consent-later',
        clientId: 'client-1',
        userId: 'ann',
        createdAt: new Date((GRANTED_IAT + 3600) * 1000),
      },
    })

    await expect(load()).resolves.toMatchObject({ userId: 'ann' })
  })
})
