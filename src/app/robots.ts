import type { MetadataRoute } from 'next'
import { clientEnv, getServerBaseURL } from '@/lib/env'
import { isIndexable } from '@/lib/indexing'

export default function robots(): MetadataRoute.Robots {
  // Staging and preview (HON-1159): crawling stays allowed, because Google
  // must fetch a page to read its `X-Robots-Tag: noindex` (next.config.ts). A
  // `Disallow: /` would keep an already-indexed page in the index.
  if (!isIndexable(clientEnv.NEXT_PUBLIC_APP_ENV)) {
    return { rules: { userAgent: '*', allow: '/' } }
  }

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
          '/meal-plans',
        ],
        disallow: [
          '/api',
          '/profile',
          '/household',
          // The trailing slash: a bare '/meal-plan' prefix also blocks the
          // public '/meal-plans' pages (HON-1085).
          '/meal-plan/',
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
