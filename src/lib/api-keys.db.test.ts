import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type ApiKeyViewer,
  createApiKey,
  getApiKeyViewer,
  hashApiKey,
  isActiveApiKeyUser,
  listApiKeys,
  MAX_API_KEYS_PER_USER,
  revokeApiKey,
  verifyApiKey,
} from '@/lib/api-keys'
import { prisma } from '@/lib/prisma'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks.

async function user(id: string) {
  return prisma.user.create({ data: { id, name: id, email: `${id}@example.com` } })
}

async function created(userId: string, name: string, expiresInDays: number | null = null) {
  const result = await createApiKey(userId, name, expiresInDays)
  if (result.status !== 'created') throw new Error('Expected a key')
  return result
}

/** A member's own view. */
const own = (userId: string): ApiKeyViewer => ({ userId, householdId: null })

/**
 * One household: `u-owner` owns it, `u-member` is a member with a display
 * name, and `u-kid` is a member known by the account name only.
 */
async function household(id = 'h-1', prefix = 'u') {
  await prisma.household.create({ data: { id, name: 'Doe Family' } })
  await user(`${prefix}-owner`)
  await user(`${prefix}-member`)
  await user(`${prefix}-kid`)
  await prisma.householdMember.create({
    data: { householdId: id, userId: `${prefix}-owner`, role: 'owner' },
  })
  await prisma.householdMember.create({
    data: {
      householdId: id,
      userId: `${prefix}-member`,
      role: 'member',
      preferences: { create: { displayName: 'Jane' } },
    },
  })
  await prisma.householdMember.create({
    data: { householdId: id, userId: `${prefix}-kid`, role: 'member' },
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('API key persistence (HON-1220)', () => {
  it('stores the hash and the start, never the key', async () => {
    await user('u-ada')

    const { key, apiKey } = await created('u-ada', 'Kitchen screen')

    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: apiKey.id } })
    expect(row.hash).toBe(hashApiKey(key))
    expect(row.start).toBe(key.slice(0, 9))
    expect(Object.values(row)).not.toContain(key)
    expect(apiKey).toEqual({
      id: row.id,
      name: 'Kitchen screen',
      start: key.slice(0, 9),
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: null,
      expiresAt: null,
      expired: false,
      memberName: null,
    })
    expect(row.expiresAt).toBeNull()
  })

  it("lists the user's own keys only, oldest first", async () => {
    await user('u-ada')
    await user('u-ben')
    await created('u-ada', 'First')
    await created('u-ben', 'Not mine')
    await created('u-ada', 'Second')

    const names = (await listApiKeys(own('u-ada'))).map((row) => row.name)

    expect(names).toEqual(['First', 'Second'])
  })

  it(`refuses key number ${MAX_API_KEYS_PER_USER + 1}`, async () => {
    await user('u-ada')
    for (let i = 0; i < MAX_API_KEYS_PER_USER; i++) await created('u-ada', `Key ${i}`)

    expect(await createApiKey('u-ada', 'One too many')).toEqual({ status: 'limit_reached' })
    expect(await prisma.apiKey.count({ where: { userId: 'u-ada' } })).toBe(MAX_API_KEYS_PER_USER)
  })

  it('verifies a key, returns its user and writes lastUsedAt', async () => {
    await user('u-ada')
    const { key, apiKey } = await created('u-ada', 'Kitchen screen')

    expect(await verifyApiKey(key)).toEqual({ userId: 'u-ada' })

    const [listed] = await listApiKeys(own('u-ada'))
    expect(listed!.id).toBe(apiKey.id)
    expect(listed!.lastUsedAt).not.toBeNull()
  })

  it('refuses an unknown key', async () => {
    expect(await verifyApiKey('wp_00000000000000000000000000000000')).toBeNull()
  })

  it('a revoked key stops verifying', async () => {
    await user('u-ada')
    const { key, apiKey } = await created('u-ada', 'Kitchen screen')

    expect(await revokeApiKey(own('u-ada'), apiKey.id)).toBe(true)

    expect(await verifyApiKey(key)).toBeNull()
    expect(await listApiKeys(own('u-ada'))).toEqual([])
  })

  it("does not revoke another user's key", async () => {
    await user('u-ada')
    await user('u-ben')
    const { key, apiKey } = await created('u-ben', 'Ben’s screen')

    expect(await revokeApiKey(own('u-ada'), apiKey.id)).toBe(false)
    expect(await verifyApiKey(key)).toEqual({ userId: 'u-ben' })
  })

  // HON-1221: the household's owner.
  it('makes the owner a household viewer and anyone else an own-keys viewer', async () => {
    await household()
    await user('u-loner')

    expect(await getApiKeyViewer('u-owner')).toEqual({ userId: 'u-owner', householdId: 'h-1' })
    expect(await getApiKeyViewer('u-member')).toEqual({ userId: 'u-member', householdId: null })
    expect(await getApiKeyViewer('u-loner')).toEqual({ userId: 'u-loner', householdId: null })
  })

  it("lists every member's keys with the member's name for the owner, and no other household's", async () => {
    await household()
    await household('h-2', 'x')
    await created('u-owner', 'Owner screen')
    await created('u-member', 'Jane screen')
    await created('u-kid', 'Kid screen')
    await created('x-member', 'Other household')

    const rows = await listApiKeys(await getApiKeyViewer('u-owner'))

    expect(rows.map((row) => [row.name, row.memberName])).toEqual([
      ['Owner screen', 'u-owner'],
      ['Jane screen', 'Jane'],
      ['Kid screen', 'u-kid'],
    ])
  })

  it("lists a member's own keys only, with no member name", async () => {
    await household()
    await created('u-owner', 'Owner screen')
    await created('u-member', 'Jane screen')

    const rows = await listApiKeys(await getApiKeyViewer('u-member'))

    expect(rows.map((row) => [row.name, row.memberName])).toEqual([['Jane screen', null]])
  })

  it("lets the owner revoke a member's key, which then stops verifying", async () => {
    await household()
    const { key, apiKey } = await created('u-member', 'Jane screen')

    expect(await revokeApiKey(await getApiKeyViewer('u-owner'), apiKey.id)).toBe(true)

    expect(await verifyApiKey(key)).toBeNull()
  })

  it("does not let a member revoke another member's or the owner's key", async () => {
    await household()
    const member = await created('u-member', 'Jane screen')
    const owner = await created('u-owner', 'Owner screen')
    const kid = await getApiKeyViewer('u-kid')

    expect(await revokeApiKey(kid, member.apiKey.id)).toBe(false)
    expect(await revokeApiKey(kid, owner.apiKey.id)).toBe(false)
    expect(await verifyApiKey(member.key)).toEqual({ userId: 'u-member' })
    expect(await verifyApiKey(owner.key)).toEqual({ userId: 'u-owner' })
  })

  it('does not let an owner revoke a key in another household', async () => {
    await household()
    await household('h-2', 'x')
    const { key, apiKey } = await created('x-member', 'Other household')

    expect(await revokeApiKey(await getApiKeyViewer('u-owner'), apiKey.id)).toBe(false)
    expect(await verifyApiKey(key)).toEqual({ userId: 'x-member' })
  })

  it('a key made to expire in 1 day verifies until then and answers null after', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-14T10:00:00.000Z'))
    await user('u-ada')
    const { key, apiKey } = await created('u-ada', 'Kitchen screen', 1)

    expect(apiKey.expiresAt).toBe('2026-10-15T10:00:00.000Z')
    expect(apiKey.expired).toBe(false)

    vi.setSystemTime(new Date('2026-10-15T09:59:00.000Z'))
    expect(await verifyApiKey(key)).toEqual({ userId: 'u-ada' })

    vi.setSystemTime(new Date('2026-10-15T10:01:00.000Z'))
    expect(await verifyApiKey(key)).toBeNull()
    const [listed] = await listApiKeys(own('u-ada'))
    expect(listed!.expired).toBe(true)
    // The refused request is not recorded as a use.
    expect(listed!.lastUsedAt).toBe('2026-10-15T09:59:00.000Z')
  })

  it('a key made without expiry keeps working', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-14T10:00:00.000Z'))
    await user('u-ada')
    const { key, apiKey } = await created('u-ada', 'Kitchen screen')
    expect(apiKey.expiresAt).toBeNull()

    vi.setSystemTime(new Date('2028-10-14T10:00:00.000Z'))

    expect(await verifyApiKey(key)).toEqual({ userId: 'u-ada' })
    const [listed] = await listApiKeys(own('u-ada'))
    expect(listed!.expiresAt).toBeNull()
    expect(listed!.expired).toBe(false)
  })

  it('treats an account waiting for deletion as inactive', async () => {
    await user('u-ada')
    await user('u-ben')
    await prisma.user.update({ where: { id: 'u-ben' }, data: { deletedAt: new Date() } })

    expect(await isActiveApiKeyUser('u-ada')).toBe(true)
    expect(await isActiveApiKeyUser('u-ben')).toBe(false)
    expect(await isActiveApiKeyUser('u-nobody')).toBe(false)
  })

  it("deletes the user's keys with the user (the purge cascade)", async () => {
    await user('u-ada')
    const { key } = await created('u-ada', 'Kitchen screen')

    await prisma.user.delete({ where: { id: 'u-ada' } })

    expect(await prisma.apiKey.count()).toBe(0)
    expect(await verifyApiKey(key)).toBeNull()
  })
})
