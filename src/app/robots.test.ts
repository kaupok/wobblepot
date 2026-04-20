import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/env', () => ({
  getServerBaseURL: () => 'https://honkadori.xyz',
}))

describe('robots', () => {
  it('returns the correct robots configuration', async () => {
    const { default: robots } = await import('./robots')
    const result = robots()

    expect(result.rules).toEqual([
      {
        userAgent: '*',
        allow: ['/', '/privacy', '/terms', '/sign-in', '/sign-up', '/bot', '/status'],
        disallow: [
          '/api',
          '/profile',
          '/household',
          '/meal-plan',
          '/pantry',
          '/shopping',
          '/onboarding',
          '/reset-password',
          '/forgot-password',
          '/invite',
          '/recipes',
          '/admin',
        ],
      },
    ])
  })

  it('includes a sitemap URL', async () => {
    const { default: robots } = await import('./robots')
    const result = robots()

    expect(result.sitemap).toBe('https://honkadori.xyz/sitemap.xml')
  })
})
