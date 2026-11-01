// ROUTES: /past-meals, /pantry · COMPONENTS: PastMealRow, PantryDeductionModal, PantrySection
import { expect, test } from '@playwright/test'

import { smokeFixture } from './utils/fixtures'
import {
  dayRows,
  daysFromNow,
  listEntries,
  type MealSummary,
  signInWithConsent,
} from './utils/past-meals'
import { pantryRows } from './utils/shopping-pantry-api'

// A past day of its own on the smoke household: past-meals.spec.ts writes -3,
// -5 and -6, and the other specs plant only today and later.
const HAVE_SOME_DAY_OFFSET = -4
const MEAL_TYPE = 'dinner'

// The Cooked dialog asks "Used up" or "Some left" for each "have some" pantry
// row (`quantity: null`), and the pantry follows the answer (HON-1564): the
// row set to Used up lands in the Ran out group, the one set to Some left
// stays as it was. The defaults come from the ingredient's category, which
// the API does not expose here, so the test sets both rows; a click on an
// option that is already the default changes nothing, so the PATCH body is
// what proves the answer reached the server.
test('the Cooked dialog marks one "have some" row used up and keeps the other', async ({
  page,
}) => {
  await signInWithConsent(page, smokeFixture())

  const date = daysFromNow(HAVE_SOME_DAY_OFFSET)
  const { entries, planId } = await listEntries(page)
  expect(planId, 'The smoke household has no meal plan (prisma/seed.ts).').toBeTruthy()
  const stale = entries.find((e) => e.date === date && e.mealType === MEAL_TYPE)
  if (stale) await page.request.delete(`/api/meal-plans/${planId}/entries/${stale.id}`)

  // Other specs share this household and assert on pantry rows of the meals
  // they plan, so pick a meal with two concrete ingredients that no planned
  // meal and no pantry row holds. The last match, because past-meals.spec.ts
  // takes the first.
  const mealsResponse = await page.request.get('/api/meals?source=system&limit=50')
  expect(mealsResponse.ok()).toBe(true)
  const { meals } = (await mealsResponse.json()) as { meals: MealSummary[] }
  const taken = new Set([
    ...(await pantryRows(page.request)).map((row) => row.ingredient.id),
    ...entries.flatMap((e) => e.meal?.components.map((c) => c.ingredientId) ?? []),
  ])
  const planned = new Set(entries.flatMap((e) => (e.meal ? [e.meal.id] : [])))
  const concrete = (m: MealSummary) => [
    ...new Set(
      m.components.filter((c) => !c.isVague && c.quantityPerServing > 0).map((c) => c.ingredientId),
    ),
  ]
  const meal = [...meals]
    .reverse()
    .find(
      (m) =>
        !planned.has(m.id) &&
        concrete(m).length >= 2 &&
        m.components.every((c) => !taken.has(c.ingredientId)),
    )
  expect(meal, 'No seeded system meal shares no ingredient with the shared household').toBeTruthy()
  const [usedUpId, someLeftId] = concrete(meal!)

  const pantryIds: string[] = []
  let entryId: string | null = null
  try {
    for (const ingredientId of [usedUpId!, someLeftId!]) {
      const response = await page.request.post('/api/pantry', { data: { ingredientId } })
      expect(response.status()).toBe(201)
      const created = (await response.json()) as { id: string; quantity: number | null }
      expect(created.quantity).toBeNull()
      pantryIds.push(created.id)
    }

    const createResponse = await page.request.post(`/api/meal-plans/${planId}/entries`, {
      data: { date, mealType: MEAL_TYPE, mealId: meal!.id },
    })
    expect(createResponse.ok()).toBe(true)
    entryId = ((await createResponse.json()) as { id: string }).id

    await page.goto('/past-meals')
    const cooked = dayRows(page, date).getByRole('button', { name: 'Cooked' })
    await cooked.click()

    const dialog = page.getByRole('dialog', { name: 'Mark as cooked' })
    const groups = dialog.getByRole('radiogroup')
    // The rows follow the meal's order, and only these two are in the pantry.
    await expect(groups).toHaveCount(2)
    const nameOf = async (index: number) =>
      ((await groups.nth(index).getAttribute('aria-label')) ?? '').replace('What is left: ', '')
    const usedUpName = await nameOf(0)
    const someLeftName = await nameOf(1)

    // Cancel returns focus to Cooked; the answer is asked again on reopen.
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(cooked).toBeFocused()
    await cooked.click()

    await groups.nth(0).getByRole('radio', { name: 'Used up' }).click()
    await groups.nth(1).getByRole('radio', { name: 'Some left' }).click()
    await expect(groups.nth(0).getByRole('radio', { name: 'Used up' })).toBeChecked()
    await expect(groups.nth(1).getByRole('radio', { name: 'Some left' })).toBeChecked()

    const [patch] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'PATCH' &&
          new URL(r.url()).pathname === `/api/meal-plans/${planId}/entries/${entryId}`,
      ),
      dialog.getByRole('button', { name: 'Confirm' }).click(),
    ])
    expect(patch.ok()).toBe(true)
    expect(patch.request().postDataJSON()).toEqual({
      status: 'completed',
      deductPantry: true,
      usedUpIngredientIds: [usedUpId],
    })
    await expect(dialog).toBeHidden()

    // The pantry page: the used-up row in the Ran out group, the other still
    // on hand.
    await page.goto('/pantry')
    const ranOutRows = page
      .getByRole('heading', { level: 3, name: /^Ran out/ })
      .locator('xpath=../following-sibling::*[1]')
    await expect(ranOutRows).toContainText(usedUpName)
    await expect(ranOutRows).not.toContainText(someLeftName)
    await expect(page.getByText(someLeftName, { exact: true }).first()).toBeVisible()

    const rows = await pantryRows(page.request)
    expect(rows.find((row) => row.ingredient.id === usedUpId)?.quantity).toBe(0)
    expect(rows.find((row) => row.ingredient.id === someLeftId)?.quantity).toBeNull()
  } finally {
    if (entryId) {
      await page.request.delete(`/api/meal-plans/${planId}/entries/${entryId}`).catch(() => {})
    }
    for (const id of pantryIds) await page.request.delete(`/api/pantry/${id}`).catch(() => {})
  }
})
