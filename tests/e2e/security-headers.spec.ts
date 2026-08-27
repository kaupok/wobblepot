// ROUTES: / · COMPONENTS: middleware (CSP)
import { test, expect } from '@playwright/test'

/**
 * Real-response CSP check (HON-561). `middleware.test.ts` unit-tests the
 * header builder in isolation, but only a live HTTP response proves the
 * middleware actually runs and sets the header. The Next.js middleware
 * bypass advisories fail this way: the CSP silently disappears while the
 * app still serves. Carries `@smoke` so the staging tier — the closest
 * mirror of production — asserts the CSP is present on every promotion.
 */
test.describe('Security headers', { tag: '@smoke' }, () => {
  test('home response carries a nonce-based CSP', async ({ request }) => {
    const response = await request.get('/')
    expect(response.ok()).toBe(true)

    const csp = response.headers()['content-security-policy']
    expect(csp, 'Content-Security-Policy header is missing').toBeTruthy()
    expect(csp).toMatch(/script-src[^;]*'nonce-[A-Za-z0-9+/=]+'/)
    const scriptSrc = csp!.split(';').find((d) => d.trim().startsWith('script-src'))!
    expect(scriptSrc).not.toContain("'unsafe-inline'")
  })
})
