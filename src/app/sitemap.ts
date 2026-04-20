import type { MetadataRoute } from 'next'
import { getServerBaseURL } from '@/lib/env'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getServerBaseURL()

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
  ]
}
