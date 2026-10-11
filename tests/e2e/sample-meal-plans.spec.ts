// ROUTES: /meal-plans/[slug], /meal-plans/[slug]/pin.png, /robots.txt, /sitemap.xml · COMPONENTS: SampleMealCard, SampleShoppingList, src/proxy.ts (PUBLIC_ROUTES)
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

  test('a sample week has a 1000 × 1500 Pinterest image, and the page links to it', async ({
    page,
    request,
  }) => {
    // The unit test mocks `next/og`; only a live server runs satori and resvg.
    const pin = await request.get('/meal-plans/family-of-four/pin.png')
    expect(pin.status()).toBe(200)
    expect(pin.headers()['content-type']).toBe('image/png')
    // A PNG's IHDR chunk holds the width and height at bytes 16–23.
    const png = await pin.body()
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1000, 1500])

    expect((await request.get('/meal-plans/nut-free-week/pin.png')).status()).toBe(404)

    await page.goto('/meal-plans/family-of-four')
    const save = page.getByRole('link', { name: 'Save to Pinterest' })
    const href = new URL((await save.getAttribute('href')) ?? '')
    expect(href.searchParams.get('media')).toMatch(/\/meal-plans\/family-of-four\/pin\.png$/)
  })

  // E2E never runs a production build, so this asserts the staging shape
  // (HON-1159). The production allow list for /meal-plans is in
  // src/app/robots.test.ts.
  test('a non-production build keeps the sample weeks out of search', async ({ request }) => {
    const page = await request.get('/meal-plans/family-of-four')
    expect(page.headers()['x-robots-tag']).toBe('noindex, nofollow')

    const robots = await (await request.get('/robots.txt')).text()
    expect(robots).toContain('Allow: /')
    expect(robots).not.toContain('Disallow:')
    expect(robots).not.toContain('Sitemap:')

    const sitemap = await (await request.get('/sitemap.xml')).text()
    expect(sitemap).not.toContain('<url>')
  })
})
