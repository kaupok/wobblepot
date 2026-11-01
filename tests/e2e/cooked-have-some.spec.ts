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
// what proves the answer reached the server. A known-amount row with plenty
// left opens at "Some left"; the cook switches it to Used up, and it lands in
// the Ran out group too (HON-1583).
test('the Cooked dialog marks "have some" and known-amount rows used up or some left', async ({
  page,
}) => {
  await signInWithConsent(page, smokeFixture())

  const date = daysFromNow(HAVE_SOME_DAY_OFFSET)
  const { entries, planId } = await listEntries(page)
  expect(planId, 'The smoke household has no meal plan (prisma/seed.ts).').toBeTruthy()
  const stale = entries.find((e) => e.date === date && e.mealType === MEAL_TYPE)
  if (stale) await page.request.delete(`/api/meal-plans/${planId}/entries/${stale.id}`)

  // Other specs share this household and assert on pantry rows of the meals
  // they plan, so pick a meal with three concrete ingredients that no planned
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
        concrete(m).length >= 3 &&
        m.components.every((c) => !taken.has(c.ingredientId)),
    )
  expect(meal, 'No seeded system meal shares no ingredient with the shared household').toBeTruthy()
  const [ingredientIds, knownId] = [concrete(meal!).slice(0, 2), concrete(meal!)[2]!]

  const pantryIds: string[] = []
  let entryId: string | null = null
  try {
    for (const ingredientId of ingredientIds) {
      const response = await page.request.post('/api/pantry', { data: { ingredientId } })
      expect(response.status()).toBe(201)
      const created = (await response.json()) as { id: string; quantity: number | null }
      expect(created.quantity).toBeNull()
      pantryIds.push(created.id)
    }
    // Far more than one meal uses, so the sum leaves some.
    const knownResponse = await page.request.post('/api/pantry', {
      data: { ingredientId: knownId, quantity: 100000 },
    })
    expect(knownResponse.status()).toBe(201)
    pantryIds.push(((await knownResponse.json()) as { id: string }).id)

    const createResponse = await page.request.post(`/api/meal-plans/${planId}/entries`, {
      data: { date, mealType: MEAL_TYPE, mealId: meal!.id },
    })
    expect(createResponse.ok()).toBe(true)
    entryId = ((await createResponse.json()) as { id: string }).id

    await page.goto('/past-meals')
    const cooked = dayRows(page, date).getByRole('button', { name: 'Cooked' })
    await cooked.click()

    const dialog = page.getByRole('dialog', { name: 'Mark as cooked' })
    // Only these three are in the pantry. Their order is the entry's
    // component order, which no query sorts, so the ids come from the PATCH
    // below. A known row shows its amount ("→"); a "have some" row does not.
    await expect(dialog.getByRole('radiogroup')).toHaveCount(3)
    const knownRow = dialog.getByRole('listitem').filter({ hasText: '→' })
    const groups = dialog.getByRole('listitem').filter({ hasNotText: '→' }).getByRole('radiogroup')
    await expect(groups).toHaveCount(2)
    const known = knownRow.getByRole('radiogroup')
    const knownName = ((await known.getAttribute('aria-label')) ?? '').replace('What is left: ', '')
    const nameOf = async (index: number) =>
      ((await groups.nth(index).getAttribute('aria-label')) ?? '').replace('What is left: ', '')
    const usedUpName = await nameOf(0)
    const someLeftName = await nameOf(1)

    // Cancel returns focus to Cooked; the answer is asked again on reopen.
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(cooked).toBeFocused()
    await cooked.click()

    await expect(known.getByRole('radio', { name: 'Some left' })).toBeChecked()
    await expect(knownRow).not.toContainText('Ran out')
    await known.getByRole('radio', { name: 'Used up' }).click()
    await expect(knownRow).toContainText('→ Ran out')
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
    const body = patch.request().postDataJSON() as { usedUpIngredientIds: string[] }
    expect(body).toEqual({
      status: 'completed',
      deductPantry: true,
      usedUpIngredientIds: expect.arrayContaining([knownId]),
    })
    expect(body.usedUpIngredientIds).toHaveLength(2)
    const usedUpId = body.usedUpIngredientIds.find((id) => id !== knownId)!
    expect(ingredientIds).toContain(usedUpId)
    const someLeftId = ingredientIds.find((id) => id !== usedUpId)!
    await expect(dialog).toBeHidden()

    // The pantry page: the used-up rows in the Ran out group, the other still
    // on hand.
    await page.goto('/pantry')
    const ranOutRows = page
      .getByRole('heading', { level: 3, name: /^Ran out/ })
      .locator('xpath=../following-sibling::*[1]')
    await expect(ranOutRows).toContainText(usedUpName)
    await expect(ranOutRows).toContainText(knownName)
    await expect(ranOutRows).not.toContainText(someLeftName)
    await expect(page.getByText(someLeftName, { exact: true }).first()).toBeVisible()

    const rows = await pantryRows(page.request)
    expect(rows.find((row) => row.ingredient.id === usedUpId)?.quantity).toBe(0)
    expect(rows.find((row) => row.ingredient.id === someLeftId)?.quantity).toBeNull()
    expect(rows.find((row) => row.ingredient.id === knownId)?.quantity).toBe(0)
  } finally {
    if (entryId) {
      await page.request.delete(`/api/meal-plans/${planId}/entries/${entryId}`).catch(() => {})
    }
    for (const id of pantryIds) await page.request.delete(`/api/pantry/${id}`).catch(() => {})
  }
})
