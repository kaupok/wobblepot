// ROUTES: / · /shopping · COMPONENTS: TimelineDayCard, AddExtra, DayExtrasRow, ShoppingSection
import { test, expect, type Page } from '@playwright/test'
import { signIn } from './utils/test-helpers'
import { e2eBaseURL } from './utils/db-helpers'
import { smokeFixture } from './utils/fixtures'

// Day extras (HON-1309) take no meal slot, so this spec needs no day of its
// own: it adds to Tomorrow, which the 7-day shopping list always covers, and
// names the day by its heading, so the runner's timezone cannot shift it.

async function signInAsSmoke(page: Page) {
  const { email, password } = smokeFixture()
  // Pre-grant consent so the CookieBanner cannot take focus or clicks.
  await page
    .context()
    .addCookies([{ name: 'consent-v1', value: 'essential', url: e2eBaseURL(), sameSite: 'Lax' }])
  await signIn(page, email, password)
}

/**
 * A household ingredient of this run. Its own name keeps it out of every
 * seeded meal and the pantry, so the parallel specs that read the shared
 * shopping list never see its line, and its line is this extra's alone.
 */
async function runIngredient(page: Page, name: string) {
  const created = await page.request.post('/api/ingredients', {
    data: {
      name,
      category: 'condiment',
      defaultUnit: 'g',
      allergens: [],
      calories: 85,
      protein: 0,
      carbs: 3,
      fat: 0,
    },
  })
  expect(created.ok(), `Creating ${name} failed with ${created.status()}`).toBe(true)
  const { ingredient } = (await created.json()) as { ingredient: { id: string } }
  return ingredient.id
}

test('an extra added to a day survives a reload and goes on the shopping list', async ({
  page,
}) => {
  await signInAsSmoke(page)

  // Lower case, as the server stores a new household ingredient's name.
  const name = `e2e extra ${Date.now().toString(36)}`
  const ingredientId = await runIngredient(page, name)
  let extraId: string | null = null
  let purchasedId: string | null = null

  try {
    await page.goto('/')
    await page.getByRole('button', { name: 'Add an extra: Tomorrow' }).click()

    const picker = page.getByRole('dialog', { name: 'Add an extra' })
    await picker.getByLabel('Search for an ingredient').fill(name)
    await picker.getByRole('button', { name: `Pick: ${name}` }).click()
    await picker.getByLabel('Amount (optional)').fill('750')

    const [created] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/api/extras') && r.request().method() === 'POST',
      ),
      picker.getByRole('button', { name: 'Add' }).click(),
    ])
    expect(created.status()).toBe(201)
    extraId = ((await created.json()) as { id: string }).id
    await expect(picker).toHaveCount(0)

    const extra = page.getByRole('button', { name: `Edit extra: ${name} 750g` })
    await expect(extra).toBeVisible()
    await page.reload()
    await expect(extra).toBeVisible()

    await page.goto('/shopping')
    const toggle = page.getByRole('checkbox', { name: `Mark ${name} as purchased` })
    await expect(toggle).toBeVisible()
    // The name and the amount share the text block beside the checkbox.
    await expect(page.getByText(name, { exact: true }).locator('..')).toContainText('750g')

    // The line is the extra's alone, with no meal behind it. Marking it
    // purchased puts it in the pantry, and a bought item leaves the list.
    const [purchase] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/shopping-list/purchase') && r.request().method() === 'POST',
      ),
      toggle.click(),
    ])
    expect(purchase.ok()).toBe(true)
    purchasedId = ingredientId
    await expect(page.getByRole('button', { name: `Remove ${name}` })).toBeVisible()
  } finally {
    if (extraId) await page.request.delete(`/api/extras/${extraId}`)
    // So the shared pantry keeps no row of this run.
    if (purchasedId) {
      await page.request.post('/api/shopping-list/unpurchase', {
        data: { ingredientId: purchasedId },
      })
    }
  }
})
