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
  ]
}
