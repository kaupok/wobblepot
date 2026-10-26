// ROUTES: /recipes · COMPONENTS: MealList, RecipeCard, RecipeDetailModal, CookViewDialog
// API: /api/meals/[id]/preparation-steps (HON-1338)
import { test, expect, type Page } from '@playwright/test'
import { signIn } from './utils/test-helpers'
import { e2eBaseURL } from './utils/db-helpers'
import { smokeFixture } from './utils/fixtures'

async function signInAsSmoke(page: Page) {
  const { email, password } = smokeFixture()
  // Pre-grant consent so the CookieBanner cannot take focus or clicks.
  await page
    .context()
    .addCookies([{ name: 'consent-v1', value: 'essential', url: e2eBaseURL(), sameSite: 'Lax' }])
  await signIn(page, email, password)
}

interface SystemMeal {
  components: { ingredientId: string }[]
}

// A recipe card on My recipes opens the cook view at the household's
// servings. The real page and database; the steps and the image are stubbed,
// so no AI call runs.
test('a recipe on My recipes opens in the cook view', async ({ page }) => {
  const stepsRequests: { servings: number }[] = []
  await page.route('**/api/meals/*/preparation-steps', async (route) => {
    stepsRequests.push(route.request().postDataJSON() as { servings: number })
    await route.fulfill({
      json: { tips: { equipment: [], steps: ['Stir the pot'], pitfalls: [] } },
    })
  })
  await page.route('**/api/meals/*/image', (route) => route.fulfill({ json: { status: 'none' } }))
  await signInAsSmoke(page)

  const mealsResponse = await page.request.get('/api/meals?source=system&limit=1')
  expect(mealsResponse.ok()).toBe(true)
  const { meals } = (await mealsResponse.json()) as { meals: SystemMeal[] }
  const ingredientId = meals[0]?.components[0]?.ingredientId
  expect(ingredientId, 'No seeded system meal with an ingredient').toBeTruthy()

  const name = `Cook view recipe ${Date.now()}`
  const createResponse = await page.request.post('/api/households/me/meals', {
    data: {
      name,
      description: 'A recipe the cook view opens.',
      suitableFor: ['dinner'],
      servings: 4,
      components: [{ ingredientId, totalQuantity: 400 }],
    },
  })
  expect(createResponse.status()).toBe(201)
  const { id: recipeId } = (await createResponse.json()) as { id: string }

  try {
    await page.goto('/recipes')
    const nameButton = page.getByRole('button', { name, exact: true })
    await nameButton.scrollIntoViewIfNeeded()
    const card = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByRole('button', { name: `More actions: ${name}` }) })

    // The heart keeps its own action.
    await card.getByRole('button', { name: /favourites/ }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // A click on the card's text, outside its controls, opens the view.
    await card.getByText('A recipe the cook view opens.').click()
    const cookView = page.getByRole('dialog', { name })
    await expect(cookView).toBeVisible()
    await expect(cookView.getByText('Stir the pot')).toBeVisible()

    // At the household's servings, which is what the steps were asked for.
    const serves = cookView.getByRole('button', { name: /^Serves / })
    const shown = Number((await serves.textContent())!.replace(/[^\d.,]/g, '').replace(',', '.'))
    expect(stepsRequests.at(-1)?.servings).toBe(shown)
    await expect(cookView.getByRole('button', { name: /Done cooking/i })).toHaveCount(0)

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(nameButton).toBeFocused()
  } finally {
    // Leave the shared household as found, whatever failed above.
    await page.request.delete(`/api/households/me/meals/${recipeId}`).catch(() => {})
  }
})
