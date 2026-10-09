// ROUTES: /profile, /invite/[code], /admin/signup-codes, /does-not-exist, / · COMPONENTS: src/proxy.ts (PROTECTED_PREFIXES)
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

  // A signed-out invitee must see the invite card, which offers Create account
  // as well as Sign in, so `/invite` is public (HON-1131).
  test('household invite links are not redirected to sign-in', async ({ request }) => {
    const response = await request.get('/invite/does-not-exist', { maxRedirects: 0 })

    expect(response.headers()['location'] ?? '').not.toContain('/sign-in')
  })

  test('public routes are unaffected', async ({ request }) => {
    const response = await request.get('/', { maxRedirects: 0 })

    expect(response.status()).toBe(200)
  })

  // /admin is deliberately NOT in PROTECTED_PREFIXES: a sign-in redirect would
  // advertise that the route exists. Instead the proxy rewrites an anonymous
  // request to a path no route matches, so it gets the ordinary 404 — same
  // status, same title, no admin copy — before anything streams (HON-830).
  test('admin routes are not redirected to sign-in', async ({ request }) => {
    const response = await request.get('/admin/signup-codes', { maxRedirects: 0 })

    expect(response.headers()['location'] ?? '').not.toContain('/sign-in')
  })

  test('admin routes are indistinguishable from a missing page', async ({ request }) => {
    const titleOf = (html: string) => html.match(/<title>([^<]*)<\/title>/)?.[1]

    const admin = await request.get('/admin/signup-codes', { maxRedirects: 0 })
    const missing = await request.get('/does-not-exist', { maxRedirects: 0 })
    const adminHtml = await admin.text()
    const missingHtml = await missing.text()

    expect(admin.status()).toBe(404)
    expect(missing.status()).toBe(404)
    expect(adminHtml).not.toContain('Signup codes')
    expect(titleOf(adminHtml)).toBeDefined()
    expect(titleOf(adminHtml)).toBe(titleOf(missingHtml))
  })
})
