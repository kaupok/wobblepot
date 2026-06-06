import { describe, expect, it, vi } from 'vitest'
import { POLICY_LAST_UPDATED } from '@/lib/consent'

vi.mock('@/lib/env', () => ({
  getServerBaseURL: () => 'https://wobblepot.com',
}))

describe('sitemap', () => {
  it('returns the home page entry', async () => {
    const { default: sitemap } = await import('./sitemap')
    const result = sitemap()

    expect(result).toHaveLength(4)
    expect(result[0]).toMatchObject({
      url: 'https://wobblepot.com',
      changeFrequency: 'weekly',
      priority: 1,
    })
  })

  it('includes the /bot info page', async () => {
    const { default: sitemap } = await import('./sitemap')
    const result = sitemap()

    expect(result[1]).toMatchObject({
      url: 'https://wobblepot.com/bot',
      changeFrequency: 'yearly',
      priority: 0.3,
    })
  })

  it('includes the legal pages with the policy version date (HON-559)', async () => {
    const { default: sitemap } = await import('./sitemap')
    const result = sitemap()

    expect(result[2]).toMatchObject({
      url: 'https://wobblepot.com/privacy',
      changeFrequency: 'yearly',
      priority: 0.5,
    })
    expect(result[3]).toMatchObject({
      url: 'https://wobblepot.com/terms',
      changeFrequency: 'yearly',
      priority: 0.5,
    })
    expect(result[2]!.lastModified).toEqual(new Date(POLICY_LAST_UPDATED))
    expect(result[3]!.lastModified).toEqual(new Date(POLICY_LAST_UPDATED))
  })

  it('includes lastModified as a Date', async () => {
    const { default: sitemap } = await import('./sitemap')
    const result = sitemap()

    for (const entry of result) {
      expect(entry.lastModified).toBeInstanceOf(Date)
    }
  })
})
