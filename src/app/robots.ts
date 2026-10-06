import type { MetadataRoute } from 'next'
import { getServerBaseURL } from '@/lib/env'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
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
        ],
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
          // Its URL carries a single-use token (HON-846).
          '/request-invite/confirm',
          '/invite',
          '/recipes',
          '/admin',
        ],
      },
    ],
    sitemap: `${getServerBaseURL()}/sitemap.xml`,
  }
}
