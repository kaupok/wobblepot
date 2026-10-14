import { afterEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ NEXT_PUBLIC_APP_ENV: 'production' }))

vi.mock('@/lib/env', () => ({
  clientEnv: env,
  getServerBaseURL: () => 'https://wobblepot.com',
}))

afterEach(() => {
  env.NEXT_PUBLIC_APP_ENV = 'production'
})

describe('robots', () => {
  it('returns the correct robots configuration', async () => {
    const { default: robots } = await import('./robots')
    const result = robots()

    expect(result.rules).toEqual([
      {
        userAgent: '*',
        allow: [
          '/',
          '/privacy',
          '/terms',
          '/sign-in',
          '/sign-up',
          '/request-invite',
          '/bot',
          '/status',
          '/meal-plans',
        ],
        disallow: [
          '/api',
          '/account',
          '/profile',
          '/household',
          '/meal-plan/',
          '/pantry',
          '/shopping',
          '/onboarding',
          '/reset-password',
          '/forgot-password',
          '/request-invite/confirm',
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

    expect(result.sitemap).toBe('https://wobblepot.com/sitemap.xml')
  })

  // HON-1159: Google must be allowed to fetch a staging page to read its
  // noindex header, so no disallow list and no sitemap.
  it.each(['staging', 'preview', 'dev', 'ci', 'test'])(
    'allows crawling with no disallow list or sitemap in %s',
    async (appEnv) => {
      env.NEXT_PUBLIC_APP_ENV = appEnv
      const { default: robots } = await import('./robots')

      expect(robots()).toEqual({ rules: { userAgent: '*', allow: '/' } })
    },
  )
})
