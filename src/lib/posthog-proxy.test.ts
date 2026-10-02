import { describe, expect, it } from 'vitest'
import { postHogRewrites } from './posthog-proxy'

describe('postHogRewrites', () => {
  it('sends static assets to the assets host and everything else to the ingest host, in that order', () => {
    expect(postHogRewrites('https://eu.i.posthog.com')).toEqual([
      {
        source: '/ingest/static/:path*',
        destination: 'https://eu-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://eu.i.posthog.com/:path*',
      },
    ])
  })

  it('derives the assets host from the region in the ingest host', () => {
    const [assets, ingest] = postHogRewrites('https://us.i.posthog.com/')
    expect(assets?.destination).toBe('https://us-assets.i.posthog.com/static/:path*')
    expect(ingest?.destination).toBe('https://us.i.posthog.com/:path*')
  })

  it('returns no rules when the host is unset', () => {
    expect(postHogRewrites(undefined)).toEqual([])
    expect(postHogRewrites('')).toEqual([])
  })
})
