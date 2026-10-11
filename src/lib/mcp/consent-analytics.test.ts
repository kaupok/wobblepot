import { describe, it, expect, vi, beforeEach } from 'vitest'

const capture = vi.fn()
vi.mock('@/lib/posthog-server', () => ({
  getPosthogServer: () => ({ capture }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    oauthConsent: { findFirst: vi.fn() },
    oauthClient: { findUnique: vi.fn() },
    householdMember: { findFirst: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { captureMcpClientConnected, MCP_CLIENT_CONNECTED_EVENT } from './consent-analytics'

const CREATED = new Date('2026-10-01T10:00:00Z')
const ALLOW_BODY = {
  accept: true,
  oauth_query: 'client_id=client-123&scope=openid+mcp%3Aread&sig=s&ba_param=client_id',
}
const CODE_REDIRECT = {
  redirect: true,
  url: 'https://claude.ai/api/mcp/auth_callback?code=abc&state=xyz&iss=https%3A%2F%2Fwobblepot.com',
}

describe('captureMcpClientConnected', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.oauthConsent.findFirst).mockResolvedValue({
      scopes: ['openid', 'mcp:read'],
      createdAt: CREATED,
      updatedAt: CREATED,
    } as never)
    vi.mocked(prisma.oauthClient.findUnique).mockResolvedValue({ name: 'Claude' } as never)
    vi.mocked(prisma.householdMember.findFirst).mockResolvedValue({ householdId: 'hh-1' } as never)
  })

  it('captures one event on Allow, keyed by the user, with no client id or URL', async () => {
    await captureMcpClientConnected({ body: ALLOW_BODY, userId: 'user-1', returned: CODE_REDIRECT })

    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith({
      distinctId: 'user-1',
      event: MCP_CLIENT_CONNECTED_EVENT,
      properties: {
        household_id: 'hh-1',
        client_name: 'Claude',
        scopes: ['openid', 'mcp:read'],
        is_reconsent: false,
      },
    })
    expect(prisma.oauthConsent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId: 'client-123', userId: 'user-1' } }),
    )
  })

  it('marks a consent the user had given before as a reconsent', async () => {
    vi.mocked(prisma.oauthConsent.findFirst).mockResolvedValue({
      scopes: ['openid', 'mcp:read'],
      createdAt: CREATED,
      updatedAt: new Date(CREATED.getTime() + 86_400_000),
    } as never)

    await captureMcpClientConnected({ body: ALLOW_BODY, userId: 'user-1', returned: CODE_REDIRECT })

    expect(capture.mock.calls[0]![0].properties.is_reconsent).toBe(true)
  })

  it('captures nothing on Deny', async () => {
    await captureMcpClientConnected({
      body: { ...ALLOW_BODY, accept: false },
      userId: 'user-1',
      returned: {
        redirect: true,
        url: 'https://claude.ai/api/mcp/auth_callback?error=access_denied&state=xyz',
      },
    })

    expect(capture).not.toHaveBeenCalled()
    expect(prisma.oauthConsent.findFirst).not.toHaveBeenCalled()
  })

  it('captures nothing when the consent endpoint failed', async () => {
    await captureMcpClientConnected({
      body: ALLOW_BODY,
      userId: 'user-1',
      returned: new Error('invalid_signature'),
    })

    expect(capture).not.toHaveBeenCalled()
  })

  it('captures nothing when Allow did not end in a code', async () => {
    // A `prompt=login` the session does not satisfy sends the user back to
    // sign-in instead of persisting the consent.
    await captureMcpClientConnected({
      body: ALLOW_BODY,
      userId: 'user-1',
      returned: { redirect: true, url: '/sign-in?client_id=client-123&sig=s' },
    })

    expect(capture).not.toHaveBeenCalled()
  })

  it('captures nothing without a session user or a stored consent', async () => {
    await captureMcpClientConnected({
      body: ALLOW_BODY,
      userId: undefined,
      returned: CODE_REDIRECT,
    })
    vi.mocked(prisma.oauthConsent.findFirst).mockResolvedValue(null)
    await captureMcpClientConnected({ body: ALLOW_BODY, userId: 'user-1', returned: CODE_REDIRECT })

    expect(capture).not.toHaveBeenCalled()
  })

  it('swallows a failed lookup, because the event is analytics only', async () => {
    vi.mocked(prisma.oauthClient.findUnique).mockRejectedValue(new Error('db down'))

    await expect(
      captureMcpClientConnected({ body: ALLOW_BODY, userId: 'user-1', returned: CODE_REDIRECT }),
    ).resolves.toBeUndefined()
    expect(capture).not.toHaveBeenCalled()
  })
})
