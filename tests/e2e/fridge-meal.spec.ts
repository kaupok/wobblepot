// ROUTES: / · COMPONENTS: MealCard, AddMealMenu, FridgeMealPicker, FridgeMealCard, FridgeCompleteDialog
import { test, expect, type Page } from '@playwright/test'
import { signIn } from './utils/test-helpers'
import { e2eBaseURL } from './utils/db-helpers'
import { smokeFixture } from './utils/fixtures'

// A day and slot of its own: the other card specs plant theirs on days 8 to
// 13 and 16, in the same household, in parallel. Inside Today's 14-day
// window, so the card renders.
const CARD_DAY_OFFSET = 7
const MEAL_TYPE = 'dinner'
const STARTING_QUANTITY = 300

interface PantryRow {
  id: string
  ingredient: { id: string }
  quantity: number | null
}

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

/**
 * A household ingredient of this run, in the pantry at `STARTING_QUANTITY`.
 * Its own name keeps it out of every seeded meal, so the parallel specs that
 * read the shared pantry and shopping list never see it change.
 */
async function pantryIngredient(page: Page, name: string) {
  const created = await page.request.post('/api/ingredients', {
    data: {
      name,
      category: 'vegetable',
      defaultUnit: 'g',
      allergens: [],
      calories: 15,
      protein: 1,
      carbs: 3,
      fat: 0,
    },
  })
  expect(created.ok(), `Creating ${name} failed with ${created.status()}`).toBe(true)
  const { ingredient } = (await created.json()) as { ingredient: { id: string } }
  const pantry = await page.request.post('/api/pantry', {
    data: { ingredientId: ingredient.id, quantity: STARTING_QUANTITY },
  })
  expect(pantry.ok(), `Adding ${name} to the pantry failed with ${pantry.status()}`).toBe(true)
  return ingredient.id
}

async function pantryQuantities(page: Page) {
  const response = await page.request.get('/api/pantry')
  expect(response.ok()).toBe(true)
  const { items } = (await response.json()) as { items: PantryRow[] }
  return new Map(items.map((item) => [item.ingredient.id, item]))
}

// A fridge meal (HON-1277): planned from the pantry and free text, kept across
// a reload, and completed with "Used it all" on one pantry item, which the
// pantry then holds at 0 while the other keeps its quantity.
test('a fridge meal is planned on a card, survives a reload, and runs out what was used up', async ({
  page,
}) => {
  await signInAsSmoke(page)

  const run = Date.now().toString(36)
  const cucumberName = `E2E cucumber ${run}`
  const paprikaName = `E2E paprika ${run}`
  const cucumberId = await pantryIngredient(page, cucumberName)
  const paprikaId = await pantryIngredient(page, paprikaName)

  const date = daysFromNow(CARD_DAY_OFFSET)
  const list = await page.request.get(
    `/api/entries?startDate=${date}&endDate=${daysFromNow(CARD_DAY_OFFSET + 1)}`,
  )
  expect(list.ok(), `GET /api/entries failed with ${list.status()}`).toBe(true)
  const { entries, planId } = (await list.json()) as {
    entries: { id: string; mealType: string }[]
    planId: string | null
  }
  expect(planId, 'The smoke household has no meal plan (prisma/seed.ts).').toBeTruthy()
  const stale = entries.find((e) => e.mealType === MEAL_TYPE)
  if (stale) await page.request.delete(`/api/meal-plans/${planId}/entries/${stale.id}`)

  // A note-only card: the note finds it, and "Add meal" offers the routes.
  const note = `e2e fridge ${run}`
  const created = await page.request.post(`/api/meal-plans/${planId}/entries`, {
    data: { date, mealType: MEAL_TYPE, note },
  })
  expect(created.ok(), `Creating the entry failed with ${created.status()}`).toBe(true)
  const { id } = (await created.json()) as { id: string }
  const entryPath = `/api/meal-plans/${planId}/entries/${id}`
  const pantryIds = [cucumberId, paprikaId]

  try {
    await page.goto('/')
    const card = page.locator('[data-slot="card"]').filter({ hasText: note })
    await card.getByRole('button', { name: 'Add meal' }).click()
    await page.getByRole('menuitem', { name: 'Fridge meal' }).click()

    const picker = page.getByRole('dialog', { name: 'Fridge meal' })
    await picker.getByLabel('Search the pantry').fill(run)
    await picker.getByRole('button', { name: `Add: ${cucumberName}` }).click()
    await picker.getByRole('button', { name: `Add: ${paprikaName}` }).click()
    await picker.getByLabel('Something else').fill('store meatballs')
    await picker.getByRole('button', { name: 'Add', exact: true }).click()
    await picker.getByRole('button', { name: 'Save' }).click()
    await expect(picker).toHaveCount(0)

    const items = [cucumberName, paprikaName, 'store meatballs']
    await expect(card.getByRole('heading', { name: 'Fridge meal' })).toBeVisible()
    await expect(card.getByRole('listitem')).toHaveText(items)

    await page.reload()
    await expect(card.getByRole('listitem')).toHaveText(items)
    // No recipe, so no cook view to open and no rating to give.
    await expect(card.getByRole('button', { name: /rate|thumbs/i })).toHaveCount(0)

    await card.getByRole('button', { name: 'More actions: Fridge meal' }).click()
    await page.getByRole('menuitem', { name: 'Eaten' }).click()
    const complete = page.getByRole('dialog', { name: 'Did you use anything up?' })
    await complete.getByRole('checkbox', { name: `Used it all: ${cucumberName}` }).check()
    await complete.getByRole('button', { name: 'Done' }).click()
    await expect(complete).toHaveCount(0)
    // The card's badge says so once the completion is saved.
    await expect(card.getByText('Eaten', { exact: true })).toBeVisible()

    const pantry = await pantryQuantities(page)
    expect(pantry.get(cucumberId)?.quantity).toBe(0)
    expect(pantry.get(paprikaId)?.quantity).toBe(STARTING_QUANTITY)
  } finally {
    await page.request.delete(entryPath).catch(() => {})
    const pantry = await pantryQuantities(page).catch(() => new Map<string, PantryRow>())
    for (const ingredientId of pantryIds) {
      const row = pantry.get(ingredientId)
      if (row) await page.request.delete(`/api/pantry/${row.id}`).catch(() => {})
    }
  }
})
