import { describe, it, expect } from 'vitest'
import { getClientIp } from './request-ip'

function makeRequest(headers: Record<string, string>): Request {
  return new Request('http://localhost/any', { headers })
}

describe('getClientIp', () => {
  it('prefers x-vercel-forwarded-for when present', () => {
    const request = makeRequest({
      'x-vercel-forwarded-for': '203.0.113.7',
      'x-forwarded-for': '198.51.100.1',
    })

    expect(getClientIp(request)).toBe('203.0.113.7')
  })

  it('trims whitespace around x-vercel-forwarded-for', () => {
    const request = makeRequest({ 'x-vercel-forwarded-for': '  203.0.113.7  ' })

    expect(getClientIp(request)).toBe('203.0.113.7')
  })

  it('falls through to x-forwarded-for when vercel header is an empty string', () => {
    // A proxy could set the header to empty; we treat that as absent.
    const request = makeRequest({
      'x-vercel-forwarded-for': '   ',
      'x-forwarded-for': '198.51.100.1',
    })

    expect(getClientIp(request)).toBe('198.51.100.1')
  })

  it('uses the first entry of x-forwarded-for when vercel header is absent', () => {
    const request = makeRequest({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1, 10.0.0.2' })

    expect(getClientIp(request)).toBe('198.51.100.1')
  })

  it('skips leading empty entries in x-forwarded-for', () => {
    const request = makeRequest({ 'x-forwarded-for': ' , 198.51.100.1' })

    expect(getClientIp(request)).toBe('198.51.100.1')
  })

  it('handles a single-entry x-forwarded-for without a comma', () => {
    const request = makeRequest({ 'x-forwarded-for': '198.51.100.1' })

    expect(getClientIp(request)).toBe('198.51.100.1')
  })

  it('returns "unknown" when neither header is present', () => {
    const request = makeRequest({})

    expect(getClientIp(request)).toBe('unknown')
  })

  it('returns "unknown" when both headers are blank', () => {
    const request = makeRequest({
      'x-vercel-forwarded-for': '',
      'x-forwarded-for': ' , ',
    })

    expect(getClientIp(request)).toBe('unknown')
  })
})
