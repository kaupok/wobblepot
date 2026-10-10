import type { MetadataRoute } from 'next'
import { POLICY_LAST_UPDATED } from '@/lib/consent'
import { getServerBaseURL } from '@/lib/env'
import {
  SAMPLE_WEEKS,
  SAMPLE_WEEKS_LAST_UPDATED,
  sampleWeekPath,
} from '@/lib/meal-plans/sample-weeks'

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
    // The public sample meal plans (HON-1085): hand-picked content that
    // changes only when a week's meals do.
    ...SAMPLE_WEEKS.map((week) => ({
      url: `${baseUrl}${sampleWeekPath(week.slug)}`,
      lastModified: new Date(SAMPLE_WEEKS_LAST_UPDATED),
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
  ]
}
