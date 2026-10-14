// ROUTES: /profile, /api/v1/meal-plan, /api/v1/shopping-list, /api/auth/user/api-keys · COMPONENTS: ApiKeysSection, NewApiKey
import { test, expect } from '@playwright/test'
import { grantEssentialCookieConsent, signUpWithHousehold } from './utils/test-helpers'

/**
 * Read-only API keys for screens and scripts (HON-1220): create a key on
 * `/profile`, read the meal plan and shopping list with it the way a kitchen
 * screen does, check that no other route accepts it, revoke it, and get 401.
 *
 * NOT `@smoke`: it signs up a throwaway account through `/api/e2e-seed`, which
 * 404s on preview and staging. Its own account, so it never touches the
 * shared fixture household's keys.
 */

const KEY_NAME = 'Kitchen screen'

test.describe('API keys', () => {
  test.setTimeout(90_000)

  test('a key made on the profile page reads the plan until it is revoked', async ({
    page,
    request,
  }) => {
    await grantEssentialCookieConsent(page)
    await signUpWithHousehold(page)

    await page.goto('/profile')
    await page.getByLabel('Key name').fill(KEY_NAME)
    await page.getByRole('button', { name: 'Create key' }).click()

    await expect(page.getByRole('heading', { name: `New key: ${KEY_NAME}` })).toBeVisible()
    const key = (await page.getByText(/^wp_[A-Za-z0-9]{32}$/).textContent())!.trim()
    expect(key).toMatch(/^wp_[A-Za-z0-9]{32}$/)
    const auth = { authorization: `Bearer ${key}` }

    // `request` carries no session cookie, so the key is the only credential.
    const plan = await request.get('/api/v1/meal-plan', { headers: auth })
    expect(plan.status(), await plan.text()).toBe(200)
    expect(plan.headers()['cache-control']).toBe('no-store')
    const planBody = (await plan.json()) as { from: string; to: string; entries: unknown[] }
    expect(planBody.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(planBody.to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(Array.isArray(planBody.entries)).toBe(true)

    const list = await request.get('/api/v1/shopping-list?days=14', { headers: auth })
    expect(list.status(), await list.text()).toBe(200)
    expect(((await list.json()) as { days: number }).days).toBe(14)

    // Any other route ignores the key, as if no credential were sent.
    const write = await request.patch('/api/meal-plans/any-plan/entries/any-entry', {
      headers: auth,
      data: { status: 'completed' },
    })
    expect(write.status()).toBe(401)
    const session = await request.get('/api/auth/get-session', { headers: auth })
    expect(await session.json()).toBeNull()

    await page.getByRole('button', { name: 'Done' }).click()
    const row = page.getByRole('listitem').filter({ hasText: KEY_NAME })
    await expect(row).toContainText(key.slice(0, 9))
    await page.getByRole('button', { name: `Revoke: ${KEY_NAME}` }).click()
    const dialog = page.getByRole('alertdialog', { name: `Revoke ${KEY_NAME}?` })
    await dialog.getByRole('button', { name: 'Revoke' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('You have no keys.')).toBeVisible()

    const revoked = await request.get('/api/v1/meal-plan', { headers: auth })
    expect(revoked.status()).toBe(401)
    expect(((await revoked.json()) as { code: string }).code).toBe('invalid_key')
  })
})
