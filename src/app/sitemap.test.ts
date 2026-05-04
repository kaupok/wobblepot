import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/env', () => ({
  getServerBaseURL: () => 'https://wobblepot.com',
}))

describe('sitemap', () => {
  it('returns the home page entry', async () => {
    const { default: sitemap } = await import('./sitemap')
    const result = sitemap()

    expect(result).toHaveLength(2)
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

  it('includes lastModified as a Date', async () => {
    const { default: sitemap } = await import('./sitemap')
    const result = sitemap()

    expect(result[0]!.lastModified).toBeInstanceOf(Date)
  })
})
