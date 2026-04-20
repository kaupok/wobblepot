import type { MetadataRoute } from 'next'
import { getServerBaseURL } from '@/lib/env'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/privacy', '/terms', '/sign-in', '/sign-up', '/bot'],
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
    ],
    sitemap: `${getServerBaseURL()}/sitemap.xml`,
  }
}
