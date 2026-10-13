import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/env', () => ({ getServerBaseURL: () => 'https://wobblepot.com' }))

import { GET, OPTIONS } from './route'
import { GET as GET_PATH_INSERTED } from './api/mcp/route'

describe('GET /.well-known/oauth-protected-resource', () => {
  it('returns the MCP resource and this origin as its authorization server', async () => {
    const response = GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/json')
    const body = await response.json()
    expect(body.resource).toBe('https://wobblepot.com/api/mcp')
    expect(body.authorization_servers).toEqual(['https://wobblepot.com'])
    expect(body.scopes_supported).toEqual(['mcp:read', 'mcp:write'])
  })

  it('allows cross-origin reads', () => {
    expect(GET().headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('answers the CORS preflight', () => {
    const response = OPTIONS()
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET')
  })

  it('serves the same document at the path-inserted location for /api/mcp', async () => {
    expect(await GET_PATH_INSERTED().json()).toEqual(await GET().json())
  })
})
