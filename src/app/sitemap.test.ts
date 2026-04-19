import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/env', () => ({
  getServerBaseURL: () => 'https://honkadori.xyz',
}))

describe('sitemap', () => {
  it('returns the home page entry', async () => {
    const { default: sitemap } = await import('./sitemap')
    const result = sitemap()

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      url: 'https://honkadori.xyz',
      changeFrequency: 'weekly',
      priority: 1,
    })
  })

  it('includes lastModified as a Date', async () => {
    const { default: sitemap } = await import('./sitemap')
    const result = sitemap()

    expect(result[0]!.lastModified).toBeInstanceOf(Date)
  })
})
