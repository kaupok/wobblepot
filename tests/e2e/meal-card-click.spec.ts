// ROUTES: / · COMPONENTS: MealCard, MealImageCard, MealDetailModal
import { test, expect, type Page } from '@playwright/test'
import { signIn } from './utils/test-helpers'
import { e2eBaseURL } from './utils/db-helpers'
import { smokeFixture } from './utils/fixtures'

// A day and slot of its own: modal-focus-restore plants its cards on day 10
// (breakfast and dinner) and note-placement on day 12 (lunch), in the same
// household, in parallel. Inside Today's 14-day window, so the card renders.
const CARD_DAY_OFFSET = 12
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

// A click anywhere on the planner card opens the cook view, not only a click
// on the name (HON-1010). Unit tests and Storybook cover each excluded control;
// this is the real pointer on the real page.
test('a click on the plate side of a meal card opens the cook view', async ({ page }) => {
  // A planned meal generates its steps as the view opens. The view is what is
  // under test, not the steps, so no Claude call runs.
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

  // A meal no other card on Today shows, so its name finds this card alone.
  // Not the first system meal: the parallel specs plant that one.
  const mealsResponse = await page.request.get('/api/meals?source=system&limit=20')
  expect(mealsResponse.ok()).toBe(true)
  const { meals } = (await mealsResponse.json()) as { meals: { id: string; name: string }[] }
  const planned = new Set(entries.flatMap((e) => (e.meal ? [e.meal.id] : [])))
  const meal = meals.slice(1).find((m) => !planned.has(m.id))
  expect(meal, 'No seeded system meal left to plan').toBeTruthy()

  const createResponse = await page.request.post(`/api/meal-plans/${planId}/entries`, {
    data: { date, mealType: MEAL_TYPE, mealId: meal!.id },
  })
  expect(createResponse.ok()).toBe(true)
  const { id: entryId } = (await createResponse.json()) as { id: string }

  try {
    await page.goto('/')
    const card = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByRole('button', { name: `More actions: ${meal!.name}` }) })
    await card.scrollIntoViewIfNeeded()
    const box = (await card.boundingBox())!

    // The bottom-right of the card, right of the badges and the title column:
    // the plate, or the empty tint on a meal without one.
    await card.click({ position: { x: box.width * 0.75, y: box.height - 8 } })

    const cookView = page.getByRole('dialog', { name: meal!.name })
    await expect(cookView).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(cookView).toBeHidden()
  } finally {
    await page.request.delete(`/api/meal-plans/${planId}/entries/${entryId}`).catch(() => {})
  }
})
