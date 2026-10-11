import { describe, it, expect, vi } from 'vitest'

// The `mcp()` plugin seeds its resource row at init; answer that read so the
// real auth instance never reaches a database.
vi.mock('@/lib/prisma', () => ({
  prisma: { oauthResource: { findFirst: vi.fn().mockResolvedValue({ id: 'seeded' }) } },
}))

import { GET, OPTIONS } from './route'

/**
 * Runs the real `auth` instance, so the document is what the `mcp()` plugin
 * configured in `src/lib/auth.ts` publishes (HON-1150). The unit test base URL
 * is `http://localhost:3000`.
 */
describe('GET /.well-known/oauth-authorization-server', () => {
  async function metadata() {
    const response = await GET(
      new Request('http://localhost:3000/.well-known/oauth-authorization-server'),
    )
    expect(response.status).toBe(200)
    return { response, body: await response.json() }
  }

  it('names the origin as issuer and the Better Auth endpoints under /api/auth', async () => {
    const { body } = await metadata()
    expect(body.issuer).toBe('http://localhost:3000')
    expect(body.authorization_endpoint).toBe('http://localhost:3000/api/auth/oauth2/authorize')
    expect(body.token_endpoint).toBe('http://localhost:3000/api/auth/oauth2/token')
    expect(body.registration_endpoint).toBe('http://localhost:3000/api/auth/oauth2/register')
    expect(body.jwks_uri).toBe('http://localhost:3000/api/auth/jwks')
  })

  it('requires PKCE with S256', async () => {
    const { body } = await metadata()
    expect(body.code_challenge_methods_supported).toContain('S256')
  })

  it('advertises the MCP read scope and refresh tokens', async () => {
    const { body } = await metadata()
    expect(body.scopes_supported).toEqual(expect.arrayContaining(['mcp:read', 'offline_access']))
    expect(body.client_id_metadata_document_supported).toBe(true)
  })

  it('allows cross-origin reads and answers the preflight', async () => {
    const { response } = await metadata()
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(OPTIONS().status).toBe(204)
  })
})
