// ROUTES: / · COMPONENTS: MealCard, MealCardMenu, AddMealMenu
import { expect, type Page, test } from '@playwright/test'

import { e2eBaseURL } from './utils/db-helpers'
import { smokeFixture } from './utils/fixtures'
import { signIn } from './utils/test-helpers'

// A day and slot of its own: the other card specs plant theirs on days 9 to
// 13, in the same household, in parallel. Past the shopping list's 7-day
// window, so the swapped-in meal never shows up in shopping-to-pantry's list;
// inside Today's 14-day one, so the card renders.
const CARD_DAY_OFFSET = 8
const MEAL_TYPE = 'dinner'

interface EntrySummary {
  id: string
  date: string
  mealType: string
  note: string | null
  meal: { id: string; name: string } | null
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

async function listEntries(page: Page) {
  const date = daysFromNow(CARD_DAY_OFFSET)
  // `endDate` is exclusive.
  const response = await page.request.get(
    `/api/entries?startDate=${date}&endDate=${daysFromNow(CARD_DAY_OFFSET + 1)}`,
  )
  expect(response.ok(), `GET /api/entries failed with ${response.status()}`).toBe(true)
  const { entries, planId } = (await response.json()) as {
    entries: EntrySummary[]
    planId: string | null
  }
  expect(planId, 'The smoke household has no meal plan (prisma/seed.ts).').toBeTruthy()
  return { planId: planId!, entry: entries.find((e) => e.mealType === MEAL_TYPE) }
}

// A planned card's Swap group offers the open slot's routes (HON-1249).
// "Pick for me" swaps in the top regenerate alternative with no dialog, and
// Undo puts the previous meal back with its note. The ranking is the server's
// own scoring, with no Claude call.
test('"Pick for me" swaps a planned meal, and Undo puts it back with its note', async ({
  page,
}) => {
  await signInAsSmoke(page)

  const { planId, entry: stale } = await listEntries(page)
  if (stale) await page.request.delete(`/api/meal-plans/${planId}/entries/${stale.id}`)

  const mealsResponse = await page.request.get('/api/meals?source=system&limit=1')
  expect(mealsResponse.ok()).toBe(true)
  const { meals } = (await mealsResponse.json()) as { meals: { id: string; name: string }[] }
  const meal = meals[0]
  expect(meal, 'No seeded system meal to plan').toBeTruthy()

  const note = `e2e pick swap ${Date.now().toString(36)}`
  const createResponse = await page.request.post(`/api/meal-plans/${planId}/entries`, {
    data: { date: daysFromNow(CARD_DAY_OFFSET), mealType: MEAL_TYPE, mealId: meal!.id, note },
  })
  expect(createResponse.ok(), `Creating the entry failed with ${createResponse.status()}`).toBe(
    true,
  )
  const { id } = (await createResponse.json()) as { id: string }
  const entryPath = `/api/meal-plans/${planId}/entries/${id}`

  try {
    await page.goto('/')
    // The note finds the card: a meal's name can repeat across cards, a
    // per-run note cannot.
    const card = page.locator('[data-slot="card"]').filter({ hasText: note })
    await card.getByRole('button', { name: `More actions: ${meal!.name}` }).click()

    const swapGroup = page.getByRole('group', { name: 'Swap' })
    await expect(swapGroup.getByRole('menuitem')).toHaveText([
      'Choose a recipe',
      'Pick for me',
      'Imagine a meal',
      'Fridge meal',
    ])
    await swapGroup.getByRole('menuitem', { name: 'Pick for me' }).click()

    const picked = page.getByText(/^Picked for you: /)
    await expect(picked).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const newName = (await picked.textContent())!.replace(/^Picked for you: /, '')
    expect(newName).not.toBe(meal!.name)
    await expect(card.getByRole('button', { name: newName, exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Undo' }).click()

    await expect(card.getByRole('button', { name: meal!.name, exact: true })).toBeVisible()
    const { entry: restored } = await listEntries(page)
    expect(restored).toMatchObject({ id, note, meal: { id: meal!.id } })
  } finally {
    await page.request.delete(entryPath).catch(() => {})
  }
})
