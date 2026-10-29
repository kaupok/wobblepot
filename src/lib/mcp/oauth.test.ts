import { describe, expect, it } from 'vitest'

import {
  buildProtectedResourceMetadata,
  getMcpIssuer,
  getMcpResource,
  knownScopes,
  MCP_SCOPES,
} from './oauth'

describe('MCP OAuth constants', () => {
  it('derives the resource and issuer from the origin', () => {
    expect(getMcpResource('https://wobblepot.com')).toBe('https://wobblepot.com/api/mcp')
    expect(getMcpIssuer('https://wobblepot.com')).toBe('https://wobblepot.com')
  })

  it('does not double a trailing slash on the origin', () => {
    expect(getMcpResource('https://wobblepot.dev/')).toBe('https://wobblepot.dev/api/mcp')
    expect(getMcpIssuer('https://wobblepot.dev/')).toBe('https://wobblepot.dev')
  })

  it('offers read and write access to MCP and a refresh token', () => {
    expect(MCP_SCOPES).toEqual(['openid', 'profile', 'offline_access', 'mcp:read', 'mcp:write'])
  })
})

describe('buildProtectedResourceMetadata', () => {
  it('names the resource and this origin as its authorization server', () => {
    expect(buildProtectedResourceMetadata('https://wobblepot.com')).toEqual({
      resource: 'https://wobblepot.com/api/mcp',
      authorization_servers: ['https://wobblepot.com'],
      bearer_methods_supported: ['header'],
      // Identity and refresh scopes belong to the authorization server.
      scopes_supported: ['mcp:read', 'mcp:write'],
    })
  })
})

describe('knownScopes', () => {
  it('keeps known scopes in display order, the data access first', () => {
    expect(knownScopes('openid offline_access mcp:write mcp:read profile')).toEqual([
      'mcp:read',
      'mcp:write',
      'openid',
      'profile',
      'offline_access',
    ])
  })

  it('drops scopes it has no copy for', () => {
    expect(knownScopes('mcp:read email mcp:admin')).toEqual(['mcp:read'])
  })

  it('returns nothing for a missing scope parameter', () => {
    expect(knownScopes(null)).toEqual([])
    expect(knownScopes('')).toEqual([])
  })
})
