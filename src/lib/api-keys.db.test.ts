import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createApiKey,
  hashApiKey,
  isActiveApiKeyUser,
  listApiKeys,
  MAX_API_KEYS_PER_USER,
  revokeApiKey,
  verifyApiKey,
} from '@/lib/api-keys'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks.

async function user(id: string) {
  return prisma.user.create({ data: { id, name: id, email: `${id}@example.com` } })
}

async function created(userId: string, name: string) {
  const result = await createApiKey(userId, name)
  if (result.status !== 'created') throw new Error('Expected a key')
  return result
}

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
    })
  })

  it("lists the user's own keys only, oldest first", async () => {
    await user('u-ada')
    await user('u-ben')
    await created('u-ada', 'First')
    await created('u-ben', 'Not mine')
    await created('u-ada', 'Second')

    const names = (await listApiKeys('u-ada')).map((row) => row.name)

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

    const [listed] = await listApiKeys('u-ada')
    expect(listed!.id).toBe(apiKey.id)
    expect(listed!.lastUsedAt).not.toBeNull()
  })

  it('refuses an unknown key', async () => {
    expect(await verifyApiKey('wp_00000000000000000000000000000000')).toBeNull()
  })

  it('a revoked key stops verifying', async () => {
    await user('u-ada')
    const { key, apiKey } = await created('u-ada', 'Kitchen screen')

    expect(await revokeApiKey('u-ada', apiKey.id)).toBe(true)

    expect(await verifyApiKey(key)).toBeNull()
    expect(await listApiKeys('u-ada')).toEqual([])
  })

  it("does not revoke another user's key", async () => {
    await user('u-ada')
    await user('u-ben')
    const { key, apiKey } = await created('u-ben', 'Ben’s screen')

    expect(await revokeApiKey('u-ada', apiKey.id)).toBe(false)
    expect(await verifyApiKey(key)).toEqual({ userId: 'u-ben' })
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
