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
import {
  isSignedOAuthRequest,
  loadConsentRequest,
  redirectTargetOf,
  signedOAuthQuery,
  toSearchParams,
} from './consent-request'

const SIGNED =
  'client_id=client-123&scope=openid+offline_access+mcp%3Aread&exp=4102444800' +
  '&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback' +
  '&ba_param=ba_param&ba_param=client_id&ba_param=exp&ba_param=redirect_uri&ba_param=scope&sig=signature'

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
      redirectTarget: 'claude.ai',
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

  it('accepts a native client whose private-use redirect URI has no host', async () => {
    const native = new URLSearchParams(SIGNED)
    native.set('redirect_uri', 'com.example.app:/oauth/callback')
    expect(await loadConsentRequest(native, 'user-1')).toMatchObject({
      status: 'ready',
      redirectTarget: 'com.example.app',
    })
  })

  it('is invalid when the signed query has no usable redirect_uri', async () => {
    const withoutRedirect = new URLSearchParams(SIGNED)
    withoutRedirect.delete('redirect_uri')
    expect((await loadConsentRequest(withoutRedirect, 'user-1')).status).toBe('invalid')

    const garbled = new URLSearchParams(SIGNED)
    garbled.set('redirect_uri', 'not a url')
    expect((await loadConsentRequest(garbled, 'user-1')).status).toBe('invalid')
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

describe('isSignedOAuthRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is true for a query with a valid signature', async () => {
    vi.mocked(verifyOAuthQueryParams).mockResolvedValue(true)
    expect(await isSignedOAuthRequest(new URLSearchParams(SIGNED))).toBe(true)
  })

  it('is false for a forged or expired signature', async () => {
    vi.mocked(verifyOAuthQueryParams).mockResolvedValue(false)
    expect(await isSignedOAuthRequest(new URLSearchParams(SIGNED))).toBe(false)
  })

  it('is false without a signed query, and checks nothing', async () => {
    expect(await isSignedOAuthRequest(new URLSearchParams('returnUrl=%2Fpantry'))).toBe(false)
    expect(verifyOAuthQueryParams).not.toHaveBeenCalled()
  })
})

describe('toSearchParams', () => {
  it('keeps repeated keys and skips undefined values', () => {
    const search = toSearchParams({ ba_param: ['a', 'b'], sig: 's', empty: undefined })
    expect(search.getAll('ba_param')).toEqual(['a', 'b'])
    expect(search.get('sig')).toBe('s')
    expect(search.has('empty')).toBe(false)
  })
})

describe('redirectTargetOf', () => {
  it('is the host of a web or loopback redirect URI', () => {
    expect(redirectTargetOf('https://claude.ai/api/mcp/auth_callback')).toBe('claude.ai')
    expect(redirectTargetOf('http://127.0.0.1:33418/callback')).toBe('127.0.0.1:33418')
  })

  it("is the scheme of a native client's private-use URI, which has no host", () => {
    expect(redirectTargetOf('com.example.app:/oauth/callback')).toBe('com.example.app')
  })

  it('is null for a missing or unparseable value', () => {
    expect(redirectTargetOf(null)).toBeNull()
    expect(redirectTargetOf('not a url')).toBeNull()
  })
})
