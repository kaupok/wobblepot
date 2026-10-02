import { describe, expect, it } from 'vitest'
import { isPostHogProxyPath, postHogRewrites } from './posthog-proxy'

describe('postHogRewrites', () => {
  it('sends static assets and remote config to the assets host and everything else to the ingest host, in that order', () => {
    expect(postHogRewrites('https://eu.i.posthog.com')).toEqual([
      {
        source: '/ingest/static/:path*',
        destination: 'https://eu-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/array/:path*',
        destination: 'https://eu-assets.i.posthog.com/array/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://eu.i.posthog.com/:path*',
      },
    ])
  })

  it('derives the assets host from the region in the ingest host', () => {
    const [assets, config, ingest] = postHogRewrites('https://us.i.posthog.com/')
    expect(assets?.destination).toBe('https://us-assets.i.posthog.com/static/:path*')
    expect(config?.destination).toBe('https://us-assets.i.posthog.com/array/:path*')
    expect(ingest?.destination).toBe('https://us.i.posthog.com/:path*')
  })

  it('returns no rules when the host is unset', () => {
    expect(postHogRewrites(undefined)).toEqual([])
    expect(postHogRewrites('')).toEqual([])
  })
})

describe('isPostHogProxyPath', () => {
  it('matches every path the /ingest rewrite matches', () => {
    expect(isPostHogProxyPath('/ingest')).toBe(true)
    expect(isPostHogProxyPath('/ingest/')).toBe(true)
    expect(isPostHogProxyPath('/ingest/e/')).toBe(true)
    expect(isPostHogProxyPath('/INGEST/e')).toBe(true)
    expect(isPostHogProxyPath('/Ingest/flags')).toBe(true)
    expect(isPostHogProxyPath('/%69ngest/e')).toBe(true)
  })

  it('does not match lookalike paths', () => {
    expect(isPostHogProxyPath('/ingestion')).toBe(false)
    expect(isPostHogProxyPath('/meal-plan/ingest')).toBe(false)
    expect(isPostHogProxyPath('/%E0%A4%A')).toBe(false)
  })
})
