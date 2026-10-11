import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth', () => ({
  auth: { $context: Promise.resolve({ secret: 'test-secret' }) },
}))

vi.mock('@better-auth/oauth-provider', () => ({
  verifyOAuthQueryParams: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    oauthClient: { findUnique: vi.fn() },
    householdMember: { findFirst: vi.fn() },
  },
}))

import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import { prisma } from '@/lib/prisma'
import { loadConsentRequest, signedOAuthQuery } from './consent-request'

const SIGNED =
  'client_id=client-123&scope=openid+offline_access+mcp%3Aread&exp=4102444800' +
  '&ba_param=ba_param&ba_param=client_id&ba_param=exp&ba_param=scope&sig=signature'

describe('signedOAuthQuery', () => {
  it('keeps the signed parameters and drops the rest', () => {
    const query = signedOAuthQuery(new URLSearchParams(`${SIGNED}&_rsc=abc&utm_source=x`))
    const params = new URLSearchParams(query!)
    expect(params.get('client_id')).toBe('client-123')
    expect(params.get('sig')).toBe('signature')
    expect(params.has('_rsc')).toBe(false)
    expect(params.has('utm_source')).toBe(false)
  })

  it('returns null for an unsigned query', () => {
    expect(signedOAuthQuery(new URLSearchParams('client_id=client-123'))).toBeNull()
    expect(signedOAuthQuery(new URLSearchParams('client_id=client-123&sig=x'))).toBeNull()
  })
})

describe('loadConsentRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(verifyOAuthQueryParams).mockResolvedValue(true)
    vi.mocked(prisma.oauthClient.findUnique).mockResolvedValue({
      name: 'Claude',
      disabled: false,
    } as never)
    vi.mocked(prisma.householdMember.findFirst).mockResolvedValue({
      household: { name: 'Kõrvid' },
    } as never)
  })

  it('returns the client, household and scopes for a valid signed request', async () => {
    const request = await loadConsentRequest(new URLSearchParams(SIGNED), 'user-1')

    expect(request).toEqual({
      status: 'ready',
      clientName: 'Claude',
      householdName: 'Kõrvid',
      scopes: ['mcp:read', 'openid', 'offline_access'],
    })
    expect(verifyOAuthQueryParams).toHaveBeenCalledWith(
      expect.stringContaining('client_id=client-123'),
      'test-secret',
    )
    expect(prisma.oauthClient.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId: 'client-123' } }),
    )
  })

  it('is invalid when the signature or expiry check fails, and reads no client', async () => {
    vi.mocked(verifyOAuthQueryParams).mockResolvedValue(false)

    expect(await loadConsentRequest(new URLSearchParams(SIGNED), 'user-1')).toEqual({
      status: 'invalid',
    })
    expect(prisma.oauthClient.findUnique).not.toHaveBeenCalled()
  })

  it('is invalid for an unsigned query', async () => {
    expect(await loadConsentRequest(new URLSearchParams('client_id=client-123'), 'user-1')).toEqual(
      { status: 'invalid' },
    )
    expect(verifyOAuthQueryParams).not.toHaveBeenCalled()
  })

  it('is invalid for an unknown or disabled client', async () => {
    vi.mocked(prisma.oauthClient.findUnique).mockResolvedValueOnce(null)
    expect((await loadConsentRequest(new URLSearchParams(SIGNED), 'user-1')).status).toBe('invalid')

    vi.mocked(prisma.oauthClient.findUnique).mockResolvedValueOnce({
      name: 'Claude',
      disabled: true,
    } as never)
    expect((await loadConsentRequest(new URLSearchParams(SIGNED), 'user-1')).status).toBe('invalid')
  })

  it('shows no name for a client that sent none, and no household before onboarding', async () => {
    vi.mocked(prisma.oauthClient.findUnique).mockResolvedValue({
      name: '  ',
      disabled: false,
    } as never)
    vi.mocked(prisma.householdMember.findFirst).mockResolvedValue(null)

    const request = await loadConsentRequest(new URLSearchParams(SIGNED), 'user-1')
    expect(request).toMatchObject({ status: 'ready', clientName: null, householdName: null })
  })
})
