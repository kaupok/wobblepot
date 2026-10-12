import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const capture = vi.fn()
vi.mock('@/lib/posthog-server', () => ({
  getPosthogServer: () => ({ capture }),
}))

const tx = {
  oauthConsent: { findFirst: vi.fn(), deleteMany: vi.fn() },
  oauthRefreshToken: { deleteMany: vi.fn() },
  oauthAccessToken: { deleteMany: vi.fn() },
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    oauthConsent: { findMany: vi.fn() },
    householdMember: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { prisma } from '@/lib/prisma'
import { disconnectMcpClient, listMcpConsents, MCP_CLIENT_DISCONNECTED_EVENT } from './consents'

const NOW = new Date('2026-10-12T12:00:00Z')
const CREATED = new Date('2026-10-02T18:00:00Z')

describe('listMcpConsents', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads only the caller’s consents and returns one row per client', async () => {
    vi.mocked(prisma.oauthConsent.findMany).mockResolvedValue([
      { clientId: 'c1', scopes: ['mcp:read'], createdAt: CREATED, client: { name: 'Claude' } },
      { clientId: 'c2', scopes: ['openid'], createdAt: null, client: { name: null } },
      { clientId: 'c1', scopes: ['openid'], createdAt: NOW, client: { name: 'Claude' } },
    ] as never)

    const result = await listMcpConsents('user-1')

    expect(prisma.oauthConsent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    )
    expect(result).toEqual([
      {
        clientId: 'c1',
        clientName: 'Claude',
        scopes: ['mcp:read'],
        createdAt: CREATED.toISOString(),
      },
      { clientId: 'c2', clientName: null, scopes: ['openid'], createdAt: null },
    ])
  })
})

describe('disconnectMcpClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: (t: typeof tx) => unknown) =>
      fn(tx)) as never)
    tx.oauthConsent.findFirst.mockResolvedValue({ createdAt: CREATED, client: { name: 'Claude' } })
    vi.mocked(prisma.householdMember.findFirst).mockResolvedValue({ householdId: 'hh-1' } as never)
  })

  afterEach(() => vi.useRealTimers())

  it('deletes the consent and both token tables for that user and client only', async () => {
    await expect(disconnectMcpClient('user-1', 'c1')).resolves.toBe(true)

    const where = { userId: 'user-1', clientId: 'c1' }
    expect(tx.oauthConsent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where }))
    expect(tx.oauthRefreshToken.deleteMany).toHaveBeenCalledWith({ where })
    expect(tx.oauthAccessToken.deleteMany).toHaveBeenCalledWith({ where })
    expect(tx.oauthConsent.deleteMany).toHaveBeenCalledWith({ where })
  })

  it('captures mcp:client_disconnected once, after the transaction', async () => {
    await disconnectMcpClient('user-1', 'c1')

    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith({
      distinctId: 'user-1',
      event: MCP_CLIENT_DISCONNECTED_EVENT,
      properties: { household_id: 'hh-1', client_name: 'Claude', days_connected: 9 },
    })
    expect(vi.mocked(prisma.$transaction).mock.invocationCallOrder[0]).toBeLessThan(
      capture.mock.invocationCallOrder[0],
    )
  })

  it('returns false and deletes and captures nothing when the user has no such consent', async () => {
    tx.oauthConsent.findFirst.mockResolvedValue(null)

    await expect(disconnectMcpClient('user-1', 'someone-elses-client')).resolves.toBe(false)

    expect(tx.oauthRefreshToken.deleteMany).not.toHaveBeenCalled()
    expect(tx.oauthAccessToken.deleteMany).not.toHaveBeenCalled()
    expect(tx.oauthConsent.deleteMany).not.toHaveBeenCalled()
    expect(capture).not.toHaveBeenCalled()
  })

  it('still disconnects when the analytics capture throws', async () => {
    capture.mockImplementationOnce(() => {
      throw new Error('posthog down')
    })

    await expect(disconnectMcpClient('user-1', 'c1')).resolves.toBe(true)
  })

  it('sends a null days_connected for a consent without a createdAt', async () => {
    tx.oauthConsent.findFirst.mockResolvedValue({ createdAt: null, client: { name: null } })

    await disconnectMcpClient('user-1', 'c1')

    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: { household_id: 'hh-1', client_name: null, days_connected: null },
      }),
    )
  })
})
