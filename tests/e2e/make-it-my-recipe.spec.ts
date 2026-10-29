// ROUTES: / /recipes · COMPONENTS: MealCard, MealDetailModal, PromoteEntry, PromoteEntryDialog
// API: /api/meal-plans/[id]/entries/[entryId]/components/promote (HON-1245)
import { expect, type Page, test } from '@playwright/test'

import { e2eBaseURL } from './utils/db-helpers'
import { smokeFixture } from './utils/fixtures'
import { signIn } from './utils/test-helpers'

// A day and slot of its own: the other smoke-household specs plant their
// cards on days 2, 10, 11, 12 and 13. Inside Today's 14-day window, so the
// card renders.
const CARD_DAY_OFFSET = 9
const MEAL_TYPE = 'dinner'

function daysFromNow(offset: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return date.toISOString().slice(0, 10)
}

async function signInAsSmoke(page: Page) {
  const { email, password } = smokeFixture()
  // Pre-grant consent so the CookieBanner cannot take focus or clicks.
  await page
    .context()
    .addCookies([{ name: 'consent-v1', value: 'essential', url: e2eBaseURL(), sameSite: 'Lax' }])
  await signIn(page, email, password)
}

interface SystemMeal {
  id: string
  name: string
  components: { ingredientId: string }[]
}

// "Make it my recipe" keeps a planned entry's ingredient change as a household
// recipe and moves the entry onto it: the card then carries the My recipe
// icon and no Changed badge, and My recipes lists it. The real page and
// database; no Claude call runs.
test('a changed library meal becomes a household recipe the entry then uses', async ({ page }) => {
  // A planned meal generates its steps as the view opens; stub them.
  await page.route('**/preparation-tips', (route) =>
    route.fulfill({ json: { tips: { equipment: [], steps: ['Cook it'], pitfalls: [] } } }),
  )
  await signInAsSmoke(page)

  const date = daysFromNow(CARD_DAY_OFFSET)
  const listResponse = await page.request.get(
    `/api/entries?startDate=${daysFromNow(-1)}&endDate=${daysFromNow(16)}`,
  )
  expect(listResponse.ok()).toBe(true)
  const { entries, planId } = (await listResponse.json()) as {
    entries: { id: string; date: string; mealType: string; meal: { id: string } | null }[]
    planId: string | null
  }
  expect(planId, 'The smoke household has no meal plan (prisma/seed.ts).').toBeTruthy()
  const stale = entries.find((e) => e.date === date && e.mealType === MEAL_TYPE)
  if (stale) await page.request.delete(`/api/meal-plans/${planId}/entries/${stale.id}`)

  // A meal no other card on Today shows, with an ingredient to leave out.
  const mealsResponse = await page.request.get('/api/meals?source=system&limit=30')
  expect(mealsResponse.ok()).toBe(true)
  const { meals } = (await mealsResponse.json()) as { meals: SystemMeal[] }
  const planned = new Set(entries.flatMap((e) => (e.meal ? [e.meal.id] : [])))
  const meal = meals.slice(2).find((m) => !planned.has(m.id) && (m.components?.length ?? 0) >= 2)
  expect(meal, 'No seeded system meal left to plan').toBeTruthy()
  const myVersion = `${meal!.name} (my version)`

  const createResponse = await page.request.post(`/api/meal-plans/${planId}/entries`, {
    data: { date, mealType: MEAL_TYPE, mealId: meal!.id },
  })
  expect(createResponse.ok()).toBe(true)
  const { id: entryId } = (await createResponse.json()) as { id: string }
  let recipeId: string | null = null

  try {
    const changeResponse = await page.request.post(
      `/api/meal-plans/${planId}/entries/${entryId}/components`,
      {
        data: {
          originalIngredientId: meal!.components[0]!.ingredientId,
          replacementIngredientId: null,
          quantityPerServing: null,
        },
      },
    )
    expect(changeResponse.status(), 'Leaving out the ingredient failed').toBe(201)

    await page.goto('/')
    const cardOf = (name: string) =>
      page
        .locator('[data-slot="card"]')
        .filter({ has: page.getByRole('button', { name: `More actions: ${name}` }) })
    const card = cardOf(meal!.name)
    await card.scrollIntoViewIfNeeded()
    await expect(card.getByText('Changed', { exact: true })).toBeVisible()
    const box = (await card.boundingBox())!
    // The plate side of the card opens the cook view (HON-1010).
    await card.click({ position: { x: box.width * 0.75, y: box.height - 8 } })

    const cookView = page.getByRole('dialog', { name: meal!.name })
    await expect(cookView).toBeVisible()
    await cookView.getByRole('button', { name: 'Make it my recipe' }).click()
    const confirm = page.getByRole('dialog', { name: 'Make it my recipe' })
    await expect(confirm.getByRole('textbox', { name: 'Recipe name' })).toHaveValue(myVersion)
    const [promoteResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/components/promote') && r.request().method() === 'POST',
      ),
      confirm.getByRole('button', { name: 'Save to My recipes' }).click(),
    ])
    expect(promoteResponse.ok()).toBe(true)
    const promoted = (await promoteResponse.json()) as { outcome: string; mealId: string }
    recipeId = promoted.mealId
    expect(promoted.outcome).toBe('forked')
    await expect(confirm).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // The card now shows the household's recipe: its name, the My recipe
    // icon, and no Changed badge, because the change lives in the recipe.
    const forked = cardOf(myVersion)
    await expect(forked.getByRole('button', { name: 'My recipe' })).toBeVisible()
    await expect(forked.getByText('Changed', { exact: true })).toHaveCount(0)

    await page.goto('/recipes')
    await expect(page.getByText(myVersion).first()).toBeVisible()
  } finally {
    // Leave the shared household as found, whatever failed above.
    await page.request.delete(`/api/meal-plans/${planId}/entries/${entryId}`).catch(() => {})
    if (recipeId) {
      await page.request.delete(`/api/households/me/meals/${recipeId}`).catch(() => {})
    }
  }
})
