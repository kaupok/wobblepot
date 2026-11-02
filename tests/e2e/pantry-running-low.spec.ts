// ROUTES: /pantry, /shopping, /sign-in · COMPONENTS: InventoryPage, PantrySection, PantryItemRow, ShoppingSection, ShoppingItem
import { expect, test } from '@playwright/test'

import { e2eBaseURL } from './utils/db-helpers'
import { smokeFixture } from './utils/fixtures'
import { findReplacement, pantryRows } from './utils/shopping-pantry-api'
import { signIn } from './utils/test-helpers'

/**
 * Pantry → Running low → shopping list → tick → pantry (HON-1587).
 *
 * `@smoke`, pattern (b)-compatible (HON-560): it signs in as the seeded smoke
 * fixture and needs no plan entry, because a low row goes on the list as a
 * line with no amount (HON-1586). The staple it adds is an ingredient the
 * pantry does not hold, and teardown deletes it.
 */
test.describe('Pantry running low', { tag: '@smoke' }, () => {
  test('a staple marked low is on the list with its tag, and a tick puts it back to have some', async ({
    page,
  }) => {
    const { email, password } = smokeFixture()
    await page
      .context()
      .addCookies([{ name: 'consent-v1', value: 'essential', url: e2eBaseURL(), sameSite: 'Lax' }])
    await signIn(page, email, password)

    const staple = await findReplacement(page.request, new Set())
    const response = await page.request.post('/api/pantry', {
      data: { ingredientId: staple.id, quantity: null, isStaple: true },
    })
    expect(response.status(), 'Adding the pantry row failed').toBe(201)

    const pantryPatch = () =>
      page.waitForResponse(
        (r) => r.url().includes('/api/pantry/') && r.request().method() === 'PATCH',
      )
    const lowToggle = page.getByRole('button', { name: `Running low: ${staple.name}` })

    try {
      await page.goto('/pantry')
      await expect(lowToggle).toHaveAttribute('aria-pressed', 'false')
      const [patch] = await Promise.all([pantryPatch(), lowToggle.click()])
      expect(patch.request().postDataJSON()).toEqual({ low: true })
      await expect(lowToggle).toHaveAttribute('aria-pressed', 'true')
      await expect(lowToggle).toBeFocused()

      await page.goto('/shopping')
      const checkbox = page.getByRole('checkbox', { name: `Mark ${staple.name} as purchased` })
      const listRow = page.locator('label', { has: checkbox })
      await expect(listRow).toContainText('Running low')
      await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/shopping-list/purchase') && r.request().method() === 'POST',
        ),
        checkbox.click(),
      ])

      // Bought: the row is back to have some, with low cleared.
      expect(
        (await pantryRows(page.request)).find((row) => row.ingredient.id === staple.id),
      ).toMatchObject({ quantity: null })
      await page.goto('/pantry')
      await expect(page.getByRole('switch', { name: `Have it: ${staple.name}` })).toBeChecked()
      await expect(lowToggle).toHaveAttribute('aria-pressed', 'false')
    } finally {
      await page.request.delete(`/api/pantry/by-ingredient/${staple.id}`).catch(() => {})
    }
  })
})
