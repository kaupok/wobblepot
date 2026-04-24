// ROUTES: / · COMPONENTS: CookieBanner, PostHogProvider
import { test, expect } from '@playwright/test'

const POSTHOG_URL_PATTERN = /posthog\.com/

test.describe('PostHog consent gating', () => {
  test('declining consent fires no PostHog requests', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    const posthogRequests: string[] = []
    await page.route('**/*', (route) => {
      const url = route.request().url()
      if (POSTHOG_URL_PATTERN.test(url)) {
        posthogRequests.push(url)
      }
      return route.continue()
    })

    await page.goto('/')

    const declineButton = page.getByRole('button', { name: 'Essential only' })
    await expect(declineButton).toBeVisible()
    await declineButton.click()

    await expect(page.getByRole('region', { name: /cookie consent/i })).not.toBeVisible()

    // Give any pending idle callbacks the chance to fire a pageview.
    await page.waitForTimeout(1500)

    expect(
      posthogRequests,
      `Expected zero PostHog requests after declining consent, saw: ${posthogRequests.join(', ')}`,
    ).toEqual([])

    const cookies = await context.cookies()
    const phCookies = cookies.filter((c) => c.name.startsWith('ph_'))
    expect(phCookies, 'Expected no ph_* cookies after declining consent').toEqual([])

    await context.close()
  })

  test('accepting consent fires at least one PostHog request', async ({ browser }) => {
    test.skip(
      !process.env.NEXT_PUBLIC_POSTHOG_KEY || !process.env.NEXT_PUBLIC_POSTHOG_HOST,
      'PostHog env not configured — skipping accept-side assertion',
    )

    const context = await browser.newContext()
    const page = await context.newPage()

    // Intercept PostHog requests so the test never hits the real vendor,
    // but still count them as the accept-side invariant.
    const posthogRequests: string[] = []
    await page.route('**/*', (route) => {
      const url = route.request().url()
      if (POSTHOG_URL_PATTERN.test(url)) {
        posthogRequests.push(url)
        return route.fulfill({ status: 204, body: '' })
      }
      return route.continue()
    })

    await page.goto('/')

    const acceptButton = page.getByRole('button', { name: 'Accept all' })
    await expect(acceptButton).toBeVisible()
    await acceptButton.click()

    // Wait for the lazy-loaded SDK to init and the first pageview to fire.
    await page.waitForTimeout(3000)

    expect(
      posthogRequests.length,
      'Expected at least one PostHog request after accepting consent',
    ).toBeGreaterThan(0)

    await context.close()
  })
})
