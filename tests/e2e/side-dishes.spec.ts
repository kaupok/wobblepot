// ROUTES: /, /recipes · COMPONENTS: MealCard, MealCardMenu, MealSelectorModal, SideDishLines, SideDishMenu, PantryDeductionModal, MealCardBase
import { expect, type Page, test } from '@playwright/test'

import { smokeFixture } from './utils/fixtures'
import {
  daysFromNow,
  type EntrySummary,
  listEntries,
  type MealSummary,
  signInWithConsent,
} from './utils/past-meals'
import { pantryRows, shoppingItems, toBuy } from './utils/shopping-pantry-api'

// A day of its own on the smoke household: the other card specs plant theirs
// on days 2 and 4 to 16. Inside Today's 14-day window, so the card renders.
const DAY_OFFSET = 3
const MEAL_TYPE = 'dinner'
const SOUR_CREAM_IN_PANTRY = 1000

interface SlotEntry extends EntrySummary {
  sides?: { entryId: string; mealId: string; status: string; servings: number }[]
}

/** A household ingredient of this run, so no seeded meal and no other spec uses it. */
async function ingredient(page: Page, name: string) {
  const created = await page.request.post('/api/ingredients', {
    data: {
      name,
      category: 'dairy',
      defaultUnit: 'g',
      allergens: [],
      calories: 100,
      protein: 2,
      carbs: 3,
      fat: 10,
    },
  })
  expect(created.ok(), `Creating ${name} failed with ${created.status()}`).toBe(true)
  return ((await created.json()) as { ingredient: { id: string } }).ingredient.id
}

// HON-1611: a household adds a side dish from the planner, removes it with
// Undo, and marks the meal cooked with the side unchecked. The side recipe is
// saved as a side dish through the recipe route, as the form's "Side dish"
// does, so the picker lists it first.
test('a side dish is added from the planner, removed with Undo, and skipped in Cooked', async ({
  page,
}) => {
  await signInWithConsent(page, smokeFixture())

  const run = Date.now().toString(36)
  const date = daysFromNow(DAY_OFFSET)
  const { entries, planId } = await listEntries(page)
  expect(planId, 'The smoke household has no meal plan (prisma/seed.ts).').toBeTruthy()
  const stale = entries.find((e) => e.date === date && e.mealType === MEAL_TYPE)
  if (stale) await page.request.delete(`/api/meal-plans/${planId}/entries/${stale.id}`)

  // A main no other card shows, so its name finds this card.
  const mealsResponse = await page.request.get('/api/meals?source=system&mealType=dinner&limit=50')
  expect(mealsResponse.ok()).toBe(true)
  const { meals } = (await mealsResponse.json()) as { meals: MealSummary[] }
  const planned = new Set(entries.flatMap((e) => (e.meal ? [e.meal.id] : [])))
  const main = meals.find((m) => !planned.has(m.id))
  expect(main, 'Every seeded dinner is planned on the smoke household').toBeTruthy()

  // Lower case, as the server stores a new household ingredient's name.
  const sourCreamName = `e2e sour cream ${run}`
  const cucumberName = `e2e cucumber ${run}`
  const sourCreamId = await ingredient(page, sourCreamName)
  const cucumberId = await ingredient(page, cucumberName)
  const pantry = await page.request.post('/api/pantry', {
    data: { ingredientId: sourCreamId, quantity: SOUR_CREAM_IN_PANTRY },
  })
  expect(pantry.ok()).toBe(true)
  const pantryId = ((await pantry.json()) as { id: string }).id

  const saladName = `E2e cucumber salad ${run}`
  const recipe = await page.request.post('/api/households/me/meals', {
    data: {
      name: saladName,
      suitableFor: ['dinner'],
      servings: 1,
      course: 'side',
      components: [
        { ingredientId: cucumberId, totalQuantity: 100 },
        { ingredientId: sourCreamId, totalQuantity: 50 },
      ],
    },
  })
  expect(recipe.status()).toBe(201)
  const recipeId = ((await recipe.json()) as { id: string }).id

  const created = await page.request.post(`/api/meal-plans/${planId}/entries`, {
    data: { date, mealType: MEAL_TYPE, mealId: main!.id },
  })
  expect(created.ok()).toBe(true)
  const entryId = ((await created.json()) as { id: string }).id
  const slot = async () => {
    const { entries: now } = await listEntries(page)
    return now.find((e) => e.id === entryId) as SlotEntry
  }

  try {
    // My recipes marks the side dish.
    await page.goto('/recipes')
    const recipeCard = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByRole('button', { name: `More actions: ${saladName}` }) })
    await recipeCard.scrollIntoViewIfNeeded()
    await expect(recipeCard.getByText('Side', { exact: true })).toBeVisible()

    await page.goto('/')
    const card = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByRole('button', { name: `More actions: ${main!.name}` }) })
    const moreActions = card.getByRole('button', { name: `More actions: ${main!.name}` })

    // Add side: the side recipe first, the main listed but refused.
    await moreActions.click()
    await page.getByRole('menuitem', { name: 'Add side' }).click()
    const picker = page.getByRole('dialog', { name: 'Add a side dish' })
    const firstCard = picker.locator('[data-slot="card"]').first()
    // An own recipe's heading ends in its "My recipe" icon.
    await expect(firstCard.getByRole('heading', { level: 3 })).toContainText(saladName)
    await firstCard.getByRole('button', { name: 'Select' }).click()
    await expect(picker).toHaveCount(0)
    await expect(page.getByText(`Side added: ${saladName}`)).toBeVisible()

    const { sides } = await slot()
    expect(sides).toHaveLength(1)
    const servings = sides![0]!.servings
    const line = card.getByRole('button', { name: `+ ${saladName} · ${servings}` })
    await expect(line).toBeVisible()
    // The salad's cucumber is on the shopping list, for the side's servings.
    expect(toBuy(await shoppingItems(page.request), cucumberId)).toBe(100 * servings)

    // Remove, then Undo in the toast.
    await line.click()
    await page.getByRole('menuitem', { name: 'Remove' }).click()
    await expect(line).toHaveCount(0)
    await expect(moreActions).toBeFocused()
    await page
      .locator('[data-sonner-toast]')
      .filter({ hasText: `Side removed: ${saladName}` })
      .getByRole('button', { name: 'Undo' })
      .click()
    await expect(line).toBeVisible()

    // Cooked with the salad unchecked: its sour cream leaves the rows.
    await moreActions.click()
    await page.getByRole('menuitem', { name: 'Cooked' }).click()
    const deduction = page.getByRole('dialog', { name: 'Mark as cooked' })
    const made = deduction.getByRole('group', { name: 'Made' })
    const salad = made.getByRole('checkbox', { name: saladName })
    await expect(salad).toBeChecked()
    await expect(deduction.getByText(sourCreamName)).toBeVisible()
    await salad.click()
    await expect(salad).not.toBeChecked()
    await expect(deduction.getByText(sourCreamName)).toHaveCount(0)

    const [patch] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'PATCH' &&
          new URL(r.url()).pathname === `/api/meal-plans/${planId}/entries/${entryId}`,
      ),
      deduction.getByRole('button', { name: 'Confirm' }).click(),
    ])
    expect(patch.ok()).toBe(true)
    const restored = (await slot()).sides![0]!
    expect(patch.request().postDataJSON()).toMatchObject({
      status: 'completed',
      skippedSideIds: [restored.entryId],
    })

    const after = await slot()
    expect(after.status).toBe('completed')
    expect(after.sides![0]!.status).toBe('skipped')
    const sourCream = (await pantryRows(page.request)).find((r) => r.ingredient.id === sourCreamId)
    expect(sourCream?.quantity).toBe(SOUR_CREAM_IN_PANTRY)
  } finally {
    // The side goes with its main.
    await page.request.delete(`/api/meal-plans/${planId}/entries/${entryId}`).catch(() => {})
    await page.request.delete(`/api/households/me/meals/${recipeId}`).catch(() => {})
    await page.request.delete(`/api/pantry/${pantryId}`).catch(() => {})
  }
})
