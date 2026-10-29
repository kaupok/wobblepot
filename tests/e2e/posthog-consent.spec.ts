// ROUTES: / · COMPONENTS: CookieBanner, PostHogProvider
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { expect, type Page, test } from '@playwright/test'

// The browser SDK goes through the same-origin `/ingest` proxy (HON-985); the
// `posthog.com` arm still catches a regression back to direct calls.
const POSTHOG_URL_PATTERN = /\/ingest\/|posthog\.com/

// Read from the installed package, so an upgrade does not silently turn the
// check into a no-op.
const POSTHOG_JS_VERSION = (
  JSON.parse(
    readFileSync(path.resolve(process.cwd(), 'node_modules/posthog-js/package.json'), 'utf8'),
  ) as { version: string }
).version

// posthog-js embeds its version as a string literal (`LIB_VERSION="1.435.8"`),
// so a JS response that contains the quoted version is the SDK chunk. Match the
// quotes too (HON-1163): `next dev` keeps module ids and comments in its chunks,
// so app chunks and the small async-loader stub carry the bare version in the
// pnpm path `posthog-js@1.435.8_…` without ever loading the SDK.
const POSTHOG_JS_MARKER = `"${POSTHOG_JS_VERSION}"`

/** URLs of the JS responses on `page` that contain the posthog-js SDK. */
function collectSdkChunks(page: Page): () => Promise<string[]> {
  const bodies: Promise<string | null>[] = []
  page.on('response', (response) => {
    const url = response.url()
    if (!/\.js(\?|$)/.test(url)) return
    bodies.push(
      response
        .text()
        .then((text) => (text.includes(POSTHOG_JS_MARKER) ? url : null))
        .catch(() => null),
    )
  })
  return async () => (await Promise.all(bodies)).filter((url): url is string => url !== null)
}

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

  // HON-999: a static import of posthog-js, or of a package that imports it
  // (`@posthog/react`), puts the SDK in the initial JS of every visitor.
  test('declining consent does not download the posthog-js SDK', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    const sdkChunksSoFar = collectSdkChunks(page)

    await page.goto('/')

    const declineButton = page.getByRole('button', { name: 'Essential only' })
    await expect(declineButton).toBeVisible()
    await declineButton.click()
    await expect(page.getByRole('region', { name: /cookie consent/i })).not.toBeVisible()

    // A client-side navigation loads the next route's chunks too.
    await page.getByRole('link', { name: 'Sign in' }).first().click()
    await page.waitForURL('**/sign-in**')
    await page.waitForTimeout(1500)

    const sdkChunks = await sdkChunksSoFar()
    expect(
      sdkChunks,
      `Expected no posthog-js ${POSTHOG_JS_VERSION} chunk after declining consent, saw: ${sdkChunks.join(', ')}`,
    ).toEqual([])

    await context.close()
  })

  test('accepting consent fires at least one PostHog request', async ({ browser }) => {
    test.skip(
      !process.env.NEXT_PUBLIC_POSTHOG_KEY || !process.env.NEXT_PUBLIC_POSTHOG_HOST,
      'PostHog env not configured — skipping accept-side assertion',
    )

    const context = await browser.newContext()
    const page = await context.newPage()
    const sdkChunksSoFar = collectSdkChunks(page)

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

    // The positive control for the marker: if a posthog-js upgrade drops the
    // quoted version from the bundle, the decline test passes vacuously.
    expect(
      await sdkChunksSoFar(),
      `Expected a JS response containing ${POSTHOG_JS_MARKER} after accepting consent`,
    ).not.toEqual([])

    await context.close()
  })
})
