import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    oauthAccessToken: { deleteMany: vi.fn() },
    oauthRefreshToken: { deleteMany: vi.fn() },
  },
}))

import { purgeExpiredOauthTokens } from './purge-expired-oauth-tokens'
import { prisma } from '@/lib/prisma'

const mockAccessDeleteMany = vi.mocked(prisma.oauthAccessToken.deleteMany)
const mockRefreshDeleteMany = vi.mocked(prisma.oauthRefreshToken.deleteMany)

const NOW = new Date('2026-10-12T03:00:00.000Z')
const HOUR_MS = 60 * 60 * 1000

type Row = { id: string; expiresAt: Date | null; revoked: Date | null }
type Where = { expiresAt: { lt: Date } }

/**
 * Wires a `deleteMany` mock to apply its `where` to an in-memory table, with
 * SQL semantics: `NULL < x` is not true, so a null `expiresAt` never matches.
 */
function backWithTable(mock: { mockImplementation(impl: never): unknown }, rows: Row[]) {
  const table = [...rows]
  mock.mockImplementation((async (args: { where: Where }) => {
    const { lt } = args.where.expiresAt
    const doomed = table.filter((row) => row.expiresAt !== null && row.expiresAt < lt)
    for (const row of doomed) table.splice(table.indexOf(row), 1)
    return { count: doomed.length }
  }) as never)
  return table
}

describe('purgeExpiredOauthTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes expired access and refresh tokens and keeps valid ones', async () => {
    const accessTable = backWithTable(mockAccessDeleteMany, [
      { id: 'a-expired', expiresAt: new Date(NOW.getTime() - HOUR_MS), revoked: null },
      { id: 'a-valid', expiresAt: new Date(NOW.getTime() + HOUR_MS), revoked: null },
    ])
    const refreshTable = backWithTable(mockRefreshDeleteMany, [
      { id: 'r-expired', expiresAt: new Date(NOW.getTime() - HOUR_MS), revoked: null },
      { id: 'r-valid', expiresAt: new Date(NOW.getTime() + 30 * 24 * HOUR_MS), revoked: null },
      // A rotated token: revoked, but kept until it expires so a replay still
      // triggers Better Auth's refresh-family revocation.
      { id: 'r-rotated', expiresAt: new Date(NOW.getTime() + 24 * HOUR_MS), revoked: NOW },
      { id: 'r-no-expiry', expiresAt: null, revoked: null },
    ])

    const result = await purgeExpiredOauthTokens(NOW)

    expect(result).toEqual({ accessTokens: 1, refreshTokens: 1 })
    expect(accessTable.map((row) => row.id)).toEqual(['a-valid'])
    expect(refreshTable.map((row) => row.id)).toEqual(['r-valid', 'r-rotated', 'r-no-expiry'])
  })

  it('filters on expiresAt alone, against the clock it is given', async () => {
    mockAccessDeleteMany.mockResolvedValue({ count: 0 })
    mockRefreshDeleteMany.mockResolvedValue({ count: 0 })

    await purgeExpiredOauthTokens(NOW)

    expect(mockAccessDeleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lt: NOW } } })
    expect(mockRefreshDeleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lt: NOW } } })
  })
})
