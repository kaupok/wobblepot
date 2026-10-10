// ROUTES: /meal-plans/[slug], /robots.txt, /sitemap.xml · COMPONENTS: SampleMealCard, SampleShoppingList, src/proxy.ts (PUBLIC_ROUTES)
import { test, expect } from '@playwright/test'

/**
 * The public sample meal plans (HON-1085) must open for an anonymous visitor
 * with the week's seven dinners from the seeded library and the call to
 * action to the waitlist. Unit tests mock the loader, so only a live page
 * proves the seed names still resolve against a real database and the proxy
 * lets the route through. No cookies, no fixtures, no Claude: tier 1.
 */
const FAMILY_OF_FOUR = [
  'Spaghetti Bolognese',
  'Chicken Fajitas',
  'Baked Salmon with Asparagus',
  'Pork Chops with Apple',
  'Margherita Pizza',
  "Shepherd's Pie",
  'Lemon Herb Roast Chicken',
]

test.describe('Sample meal plans', () => {
  test('a sample week opens anonymously with seven dinners and the call to action', async ({
    page,
  }) => {
    const response = await page.goto('/meal-plans/family-of-four')
    expect(response?.status()).toBe(200)
    expect(page.url()).toContain('/meal-plans/family-of-four')

    await expect(
      page.getByRole('heading', { level: 1, name: 'A week of dinners for a family of four' }),
    ).toBeVisible()

    const dinners = page.getByRole('region', { name: "The week's dinners" })
    await expect(dinners.getByRole('heading', { level: 3 })).toHaveText(FAMILY_OF_FOUR)

    await expect(
      page.getByRole('heading', { level: 2, name: 'Shopping list for the week' }),
    ).toBeVisible()

    await expect(page.getByRole('link', { name: "Plan this week's dinners" })).toHaveAttribute(
      'href',
      '/request-invite?ref=mp-family-of-four',
    )

    const jsonLd = await page.locator('script[type="application/ld+json"]').textContent()
    const data = JSON.parse(jsonLd ?? '{}')
    expect(data['@type']).toBe('ItemList')
    expect(data.itemListElement).toHaveLength(7)
  })

  test('robots.txt lets crawlers reach the sample weeks, and the sitemap lists them', async ({
    request,
  }) => {
    const robots = await (await request.get('/robots.txt')).text()
    expect(robots).toContain('Allow: /meal-plans')
    expect(robots).toContain('Disallow: /meal-plan/')
    expect(robots).not.toMatch(/Disallow: \/meal-plan$/m)

    const sitemap = await (await request.get('/sitemap.xml')).text()
    expect(sitemap).toContain('/meal-plans/family-of-four</loc>')
    expect(sitemap).toContain('/meal-plans/vegetarian-week</loc>')
  })
})
