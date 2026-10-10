import { describe, expect, it, vi } from 'vitest'
import { POLICY_LAST_UPDATED } from '@/lib/consent'

vi.mock('@/lib/env', () => ({
  getServerBaseURL: () => 'https://wobblepot.com',
}))

describe('sitemap', () => {
  it('returns the home page entry', async () => {
    const { default: sitemap } = await import('./sitemap')
    const result = sitemap()

    expect(result).toHaveLength(11)
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
      url: 'https://wobblepot.com/privacy/subprocessors',
      changeFrequency: 'yearly',
      priority: 0.3,
    })
    expect(result[4]).toMatchObject({
      url: 'https://wobblepot.com/terms',
      changeFrequency: 'yearly',
      priority: 0.5,
    })
    expect(result[2]!.lastModified).toEqual(new Date(POLICY_LAST_UPDATED))
    expect(result[3]!.lastModified).toEqual(new Date(POLICY_LAST_UPDATED))
    expect(result[4]!.lastModified).toEqual(new Date(POLICY_LAST_UPDATED))
  })

  it('lists the six sample meal plans (HON-1085)', async () => {
    const { default: sitemap } = await import('./sitemap')
    const result = sitemap()

    expect(result.slice(5).map((entry) => entry.url)).toEqual([
      'https://wobblepot.com/meal-plans/family-of-four',
      'https://wobblepot.com/meal-plans/two-adults-and-a-toddler',
      'https://wobblepot.com/meal-plans/one-adult-two-kids',
      'https://wobblepot.com/meal-plans/thirty-minute-dinners',
      'https://wobblepot.com/meal-plans/vegetarian-week',
      'https://wobblepot.com/meal-plans/kid-friendly-week',
    ])
    for (const entry of result.slice(5)) {
      expect(entry).toMatchObject({ changeFrequency: 'monthly', priority: 0.8 })
    }
  })

  it('includes lastModified as a Date', async () => {
    const { default: sitemap } = await import('./sitemap')
    const result = sitemap()

    for (const entry of result) {
      expect(entry.lastModified).toBeInstanceOf(Date)
    }
  })
})
