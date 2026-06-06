import type { MetadataRoute } from 'next'
import { POLICY_LAST_UPDATED } from '@/lib/consent'
import { getServerBaseURL } from '@/lib/env'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getServerBaseURL()
  // Legal pages change only on material policy updates (HON-559); the date
  // is the policy version date, bumped alongside CURRENT_TERMS_VERSION.
  const policyLastModified = new Date(POLICY_LAST_UPDATED)

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${baseUrl}/bot`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified: policyLastModified,
      changeFrequency: 'yearly',
      priority: 0.5,
    },
    {
      url: `${baseUrl}/privacy/subprocessors`,
      lastModified: policyLastModified,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: policyLastModified,
      changeFrequency: 'yearly',
      priority: 0.5,
    },
  ]
}
