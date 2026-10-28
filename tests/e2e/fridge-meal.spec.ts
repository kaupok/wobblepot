// ROUTES: / · COMPONENTS: MealCard, MealCardMenu, AddMealMenu, FridgeMealPicker, LeftoverServingsControl, FridgeMealCard, FridgeCompleteDialog
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
// The leftover-lunch test's own days: a planned dinner, and the next day's
// dinner that takes its leftovers. No other spec plants on days 4 and 5.
const SOURCE_DAY_OFFSET = 4
const LEFTOVER_DAY_OFFSET = 5

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
  // Lower case, as the server stores a new household ingredient's name.
  const cucumberName = `e2e cucumber ${run}`
  const paprikaName = `e2e paprika ${run}`
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
    const search = picker.getByLabel('What are you having?')
    await search.fill(run)
    await picker.getByRole('button', { name: `Add: ${cucumberName}` }).click()
    // An add clears the search and focuses it (HON-1287), so search again.
    await expect(search).toHaveValue('')
    await expect(search).toBeFocused()
    await search.fill(run)
    await picker.getByRole('button', { name: `Add: ${paprikaName}` }).click()
    // Enter takes words that name no pantry item as they are.
    await search.fill('store meatballs')
    await search.press('Enter')
    await picker.getByRole('button', { name: 'Save' }).click()
    await expect(picker).toHaveCount(0)

    // The items are the card's name, with the first letter in capitals.
    const items = [cucumberName, paprikaName, 'store meatballs']
    const name = `E${items.join(', ').slice(1)}`
    await expect(card.getByRole('heading', { name })).toBeVisible()
    await expect(card.getByText('Nothing to buy')).toBeVisible()

    await page.reload()
    await expect(card.getByRole('heading', { name })).toBeVisible()
    // No recipe, so no cook view to open and no rating to give.
    await expect(card.getByRole('button', { name: /rate|thumbs/i })).toHaveCount(0)

    // The ⋯ name lists the items, so two fridge cards differ (HON-1287).
    await card
      .getByRole('button', { name: `More actions: Fridge meal: ${items.join(', ')}` })
      .click()
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

interface SystemMeal {
  id: string
  name: string
}

// Leftovers from a dinner still to cook (HON-1396): the picker lists it,
// marked "planned", its item takes servings, and the dinner then cooks for
// them. The smoke household plans dinner only (prisma/seed.ts), so the
// dinner's "Cook for tomorrow's lunch too" says lunch is off.
test("a fridge meal takes a planned dinner's leftovers, and the dinner cooks for them", async ({
  page,
}) => {
  await signInAsSmoke(page)

  const sourceDate = daysFromNow(SOURCE_DAY_OFFSET)
  const leftoverDate = daysFromNow(LEFTOVER_DAY_OFFSET)
  const list = await page.request.get(
    `/api/entries?startDate=${daysFromNow(-1)}&endDate=${daysFromNow(16)}`,
  )
  expect(list.ok(), `GET /api/entries failed with ${list.status()}`).toBe(true)
  const { entries, planId } = (await list.json()) as {
    entries: { id: string; date: string; mealType: string; meal: { id: string } | null }[]
    planId: string | null
  }
  expect(planId, 'The smoke household has no meal plan (prisma/seed.ts).').toBeTruthy()
  for (const stale of entries) {
    if ((stale.date === sourceDate || stale.date === leftoverDate) && stale.mealType === 'dinner') {
      await page.request.delete(`/api/meal-plans/${planId}/entries/${stale.id}`)
    }
  }

  // A meal no other card on Today shows, so its name finds the one card.
  const mealsResponse = await page.request.get('/api/meals?source=system&limit=30')
  expect(mealsResponse.ok()).toBe(true)
  const { meals } = (await mealsResponse.json()) as { meals: SystemMeal[] }
  const planned = new Set(entries.flatMap((e) => (e.meal ? [e.meal.id] : [])))
  const meal = meals.slice(4).find((m) => !planned.has(m.id))
  expect(meal, 'No seeded system meal left to plan').toBeTruthy()
  const sourceResponse = await page.request.post(`/api/meal-plans/${planId}/entries`, {
    data: { date: sourceDate, mealType: 'dinner', mealId: meal!.id },
  })
  expect(sourceResponse.ok(), `Planning the dinner failed with ${sourceResponse.status()}`).toBe(
    true,
  )
  const { id: sourceId } = (await sourceResponse.json()) as { id: string }
  const note = `e2e leftovers ${Date.now().toString(36)}`
  const noteResponse = await page.request.post(`/api/meal-plans/${planId}/entries`, {
    data: { date: leftoverDate, mealType: 'dinner', note },
  })
  expect(noteResponse.ok()).toBe(true)
  const { id: leftoverId } = (await noteResponse.json()) as { id: string }

  try {
    await page.goto('/')
    const card = page.locator('[data-slot="card"]').filter({ hasText: note })
    await card.getByRole('button', { name: 'Add meal' }).click()
    await page.getByRole('menuitem', { name: 'Fridge meal' }).click()

    const picker = page.getByRole('dialog', { name: 'Fridge meal' })
    await picker
      .getByRole('button', { name: new RegExp(`^Add: ${meal!.name}, from .* · planned$`) })
      .click()
    const servings = picker.getByRole('group', { name: new RegExp(`^Servings: ${meal!.name}`) })
    const shown = await servings.getByText(/servings?$/).textContent()
    await servings.getByRole('button', { name: 'More servings' }).click()
    await expect(servings.getByText(/servings?$/)).not.toHaveText(shown ?? '')
    const taken = (await servings.getByText(/servings?$/).textContent())!.split(' ')[0]
    await picker.getByRole('button', { name: 'Save' }).click()
    await expect(picker).toHaveCount(0)

    // The leftovers' meal is the fridge card's name, and its line names the
    // source's slot and servings, and "planned".
    await expect(card.getByRole('heading', { name: meal!.name })).toBeVisible()
    await expect(card).toContainText(new RegExp(`at dinner · ${taken} servings · planned`))
    // The dinner cooks for the leftovers too (HON-1395's display). Its ⋯ is
    // named by the meal alone, which tells it from the fridge card.
    const dinnerMenu = page.getByRole('button', {
      name: `More actions: ${meal!.name}`,
      exact: true,
    })
    const dinner = page.locator('[data-slot="card"]').filter({ has: dinnerMenu })
    await expect(dinner).toContainText(`${taken} for dinner:`)

    // Lunch is off for the smoke household, so the action says so.
    await dinnerMenu.click()
    const action = page.getByRole('menuitem', { name: /Cook for tomorrow's lunch too/ })
    await expect(action).toHaveAttribute('aria-disabled', 'true')
    await expect(action).toContainText('Lunch is off for that day.')
  } finally {
    await page.request.delete(`/api/meal-plans/${planId}/entries/${leftoverId}`).catch(() => {})
    await page.request.delete(`/api/meal-plans/${planId}/entries/${sourceId}`).catch(() => {})
  }
})
