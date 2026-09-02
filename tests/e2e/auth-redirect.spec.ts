// ROUTES: /profile, /invite/[code], /admin/signup-codes, / · COMPONENTS: src/proxy.ts (PROTECTED_PREFIXES)
import { test, expect } from '@playwright/test'

/**
 * Anonymous requests to a protected route must get a real 307 from the proxy,
 * not a streamed 200 + skeleton with a client-side bounce (HON-599). Every page
 * gate runs after an `await` inside a Suspense boundary, so by the time
 * `redirect()` is reached the status is already flushed — only `src/proxy.ts`
 * runs early enough to set the status.
 *
 * `src/proxy.test.ts` unit-tests the prefix matching in isolation; only a live
 * HTTP response proves the proxy actually runs and returns the redirect. Uses
 * the `request` fixture (no cookies, no sign-in helpers) so it stays tier-1:
 * no Claude calls, no fixtures, runs on every push.
 */
test.describe('Anonymous access to protected routes', () => {
  test('protected route returns a hard 307 to sign-in with a returnUrl', async ({ request }) => {
    const response = await request.get('/profile', { maxRedirects: 0 })

    expect(response.status()).toBe(307)
    expect(response.headers()['location']).toContain('/sign-in?returnUrl=%2Fprofile')
  })

  test('invite links redirect before the invite card streams', async ({ request }) => {
    const response = await request.get('/invite/does-not-exist', { maxRedirects: 0 })

    expect(response.status()).toBe(307)
    expect(response.headers()['location']).toContain(
      '/sign-in?returnUrl=%2Finvite%2Fdoes-not-exist',
    )
  })

  test('public routes are unaffected', async ({ request }) => {
    const response = await request.get('/', { maxRedirects: 0 })

    expect(response.status()).toBe(200)
  })

  // /admin is deliberately NOT in PROTECTED_PREFIXES: a sign-in redirect would
  // advertise that the route exists. Its intended response is a 404 served by
  // `src/app/admin/layout.tsx` (HON-593). The status itself belongs to that
  // issue, so assert only the contract this one owns — no bounce to sign-in.
  test('admin routes are not redirected to sign-in', async ({ request }) => {
    const response = await request.get('/admin/signup-codes', { maxRedirects: 0 })

    expect(response.headers()['location'] ?? '').not.toContain('/sign-in')
  })
})
