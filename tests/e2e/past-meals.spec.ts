// ROUTES: /past-meals · COMPONENTS: PastMealsList, PastMealRow, PastEmptyRow, DayAddMenu, LogMealPicker, PantryDeductionModal, MealRatingInline, Header (User menu)
import { expect, type Page, test } from '@playwright/test'

import { e2eBaseURL } from './utils/db-helpers'
import { smokeFixture } from './utils/fixtures'
import { signIn } from './utils/test-helpers'

// A past day and slot of its own. The other specs on the smoke household plant
// only on today and later days, so nothing else writes here.
const PAST_DAY_OFFSET = -3
const MEAL_TYPE = 'dinner'
// The day the log test writes to, apart from the other test's day.
const LOG_DAY_OFFSET = -5
// The day the heading Add test writes to, apart from both.
const HEADING_LOG_DAY_OFFSET = -6

// A past day's heading line: its heading, and the "+ Add" for the meal types
// the day does not expect (HON-1519).
const headingLine = (page: Page, date: string) => page.locator(`div:has(> #past-day-${date})`)
// The day's rows sit in the `RowGroup` right after its heading line.
const dayRows = (page: Page, date: string) =>
  page.locator(`div:has(> #past-day-${date}) + [data-slot="row-group"]`)

interface MealSummary {
  id: string
  name: string
  components: { ingredientId: string; quantityPerServing: number; isVague?: boolean }[]
}

interface EntrySummary {
  id: string
  date: string
  mealType: string
  status: string
  rating: string | null
  pantryDeducted?: boolean
  meal: MealSummary | null
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
  const response = await page.request.get(
    `/api/entries?startDate=${daysFromNow(-8)}&endDate=${daysFromNow(16)}`,
  )
  expect(response.ok()).toBe(true)
  return (await response.json()) as { entries: EntrySummary[]; planId: string | null }
}

// The account trigger's name while the household has past meals to mark: the
// red dot on it is aria-hidden, so the name carries it (HON-1028).
const ACCOUNT_MENU_WITH_DOT = 'User menu, past meals to mark'

/**
 * Past meals still to mark other than `exceptId`, counted as the header counts
 * them: planned, with a meal, in `[today − 7, today)` of the household's day.
 * Other specs share this household, so the dot after marking our entry
 * depends on what they left behind.
 */
async function otherPastMealsToMark(page: Page, exceptId: string) {
  const householdResponse = await page.request.get('/api/households/me')
  expect(householdResponse.ok()).toBe(true)
  const { timezone } = (await householdResponse.json()) as { timezone: string }
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const start = new Date(`${today}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - 7)
  const startDate = start.toISOString().slice(0, 10)

  const { entries } = await listEntries(page)
  return entries.filter(
    (e) =>
      e.id !== exceptId &&
      e.date >= startDate &&
      e.date < today &&
      e.status === 'planned' &&
      e.meal !== null,
  ).length
}

// The real page, the real PATCH and the real pantry charge: Cooked completes
// the entry and charges it, and the row and the rating survive a reload
// (HON-1018). The meal shares no ingredient with the pantry, so there is
// nothing to preview and no dialog to confirm (HON-1125); the deduction dialog
// is covered by PastMealRow's tests and stories. The account menu's dot
// follows each status change through `router.refresh()`, with no reload
// (HON-1028). Unit tests and Storybook cover the row in isolation.
test('a past meal is marked cooked from its row in one click, charged once, and rated', async ({
  page,
}) => {
  await signInAsSmoke(page)

  const date = daysFromNow(PAST_DAY_OFFSET)
  const { entries, planId } = await listEntries(page)
  expect(planId, 'The smoke household has no meal plan (prisma/seed.ts).').toBeTruthy()
  const stale = entries.find((e) => e.date === date && e.mealType === MEAL_TYPE)
  if (stale) await page.request.delete(`/api/meal-plans/${planId}/entries/${stale.id}`)

  // Completing a meal deletes the household's unquantified pantry rows for its
  // ingredients. shopping-to-pantry shares this household and asserts on rows
  // it buys in parallel, for the first system meal with a concrete component
  // and for whatever else is planned. So pick a meal that shares no
  // ingredient with those meals or with the pantry as it stands.
  const mealsResponse = await page.request.get('/api/meals?source=system&limit=50')
  expect(mealsResponse.ok()).toBe(true)
  const { meals } = (await mealsResponse.json()) as { meals: MealSummary[] }
  const pantryResponse = await page.request.get('/api/pantry')
  expect(pantryResponse.ok()).toBe(true)
  const { items } = (await pantryResponse.json()) as {
    items: { isStaple: boolean; ingredient: { id: string } }[]
  }
  const shoppingMeal = meals.find((m) =>
    m.components.some((c) => !c.isVague && c.quantityPerServing > 0),
  )
  const taken = new Set([
    ...items.filter((item) => !item.isStaple).map((item) => item.ingredient.id),
    ...[shoppingMeal, ...entries.map((e) => e.meal)].flatMap(
      (m) => m?.components.map((c) => c.ingredientId) ?? [],
    ),
  ])
  const planned = new Set(entries.flatMap((e) => (e.meal ? [e.meal.id] : [])))
  const meal = meals.find(
    (m) =>
      m !== shoppingMeal &&
      !planned.has(m.id) &&
      m.components.length > 0 &&
      m.components.every((c) => !taken.has(c.ingredientId)),
  )
  expect(meal, 'No seeded system meal shares no ingredient with the shared household').toBeTruthy()

  const createResponse = await page.request.post(`/api/meal-plans/${planId}/entries`, {
    data: { date, mealType: MEAL_TYPE, mealId: meal!.id },
  })
  expect(createResponse.ok()).toBe(true)
  const { id: entryId } = (await createResponse.json()) as { id: string }

  try {
    await page.goto('/past-meals')
    await expect(page.getByRole('heading', { level: 1, name: 'Past meals' })).toBeVisible()

    // The row has no role of its own; it is the one whose text is this meal.
    const row = () =>
      page.locator('[data-slot="row-group"] > div').filter({ hasText: meal!.name }).first()
    const undo = row().getByRole('button', { name: `Undo: ${meal!.name}` })
    // The visible trigger only: the other breakpoint's is `display: none`.
    const accountMenu = page.getByRole('button', { name: /^User menu/ })

    // Our entry is past and planned, so the account menu shows the dot.
    await expect(accountMenu).toHaveAccessibleName(ACCOUNT_MENU_WITH_DOT)

    const [patch] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'PATCH' &&
          new URL(r.url()).pathname === `/api/meal-plans/${planId}/entries/${entryId}`,
      ),
      row().getByRole('button', { name: 'Cooked' }).click(),
    ])
    expect(patch.ok()).toBe(true)
    expect(patch.request().postDataJSON()).toEqual({ status: 'completed', deductPantry: true })
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(undo).toBeFocused()

    // Marked, the dot clears unless another past meal is still to mark.
    const othersToMark = await otherPastMealsToMark(page, entryId)
    await expect(accountMenu).toHaveAccessibleName(
      othersToMark > 0 ? ACCOUNT_MENU_WITH_DOT : 'User menu',
    )

    await row().getByRole('button', { name: 'Thumbs up' }).click()
    await expect(row().getByRole('button', { name: 'Thumbs up' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // Persisted: completed, charged once, and rated.
    await expect
      .poll(async () => {
        const entry = (await listEntries(page)).entries.find((e) => e.id === entryId)
        return (
          entry && { status: entry.status, charged: entry.pantryDeducted, rating: entry.rating }
        )
      })
      .toEqual({ status: 'completed', charged: true, rating: 'up' })

    await page.reload()
    await expect(row().getByText('Cooked', { exact: true })).toBeVisible()
    await expect(row().getByRole('button', { name: 'Thumbs up' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // Undo returns the row to planned and focus to Cooked.
    await undo.click()
    await expect(row().getByRole('button', { name: 'Cooked' })).toBeFocused()
    // Undo is not a deduction, and it still refreshes: the dot is back.
    await expect(accountMenu).toHaveAccessibleName(ACCOUNT_MENU_WITH_DOT)
  } finally {
    await page.request.delete(`/api/meal-plans/${planId}/entries/${entryId}`).catch(() => {})
  }
})

// Add on an empty past slot logs what the household ate (HON-1383): one POST
// with `status: 'completed'`, no pantry dialog and no pantry charge. The log
// is saved as already charged (HON-1391), so Undo then Cooked asks for no
// deduction and opens no dialog. The row shows Cooked, the thumbs and Undo.
// Undo, then Remove, leaves the slot empty with Add again. The smoke household
// expects dinner on every day.
test('a dinner is logged in an empty past slot, cooked again, then removed', async ({ page }) => {
  await signInAsSmoke(page)

  const date = daysFromNow(LOG_DAY_OFFSET)
  const { entries, planId } = await listEntries(page)
  expect(planId, 'The smoke household has no meal plan (prisma/seed.ts).').toBeTruthy()
  const stale = entries.find((e) => e.date === date && e.mealType === MEAL_TYPE)
  if (stale) await page.request.delete(`/api/meal-plans/${planId}/entries/${stale.id}`)

  const mealsResponse = await page.request.get('/api/meals?source=system&mealType=dinner&limit=1')
  expect(mealsResponse.ok()).toBe(true)
  const [meal] = ((await mealsResponse.json()) as { meals: MealSummary[] }).meals
  expect(meal, 'No seeded system dinner').toBeTruthy()

  let entryId: string | null = null
  try {
    await page.goto('/past-meals')
    const day = dayRows(page, date)
    const add = day.getByRole('button', { name: /^Add to / })
    await expect(add).toHaveAccessibleDescription('Dinner')

    await add.click()
    await page.getByRole('menuitem', { name: 'Choose a recipe' }).click()
    const dialog = page.getByRole('dialog', { name: 'Choose a recipe' })
    await dialog.getByRole('searchbox', { name: 'Search recipes' }).fill(meal!.name)

    const [post] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          new URL(r.url()).pathname === `/api/meal-plans/${planId}/entries`,
      ),
      dialog.getByRole('button', { name: meal!.name, exact: true }).first().click(),
    ])
    expect(post.ok()).toBe(true)
    expect(post.request().postDataJSON()).toEqual({
      date,
      mealType: MEAL_TYPE,
      mealId: meal!.id,
      status: 'completed',
    })
    entryId = ((await post.json()) as { id: string }).id

    // Saved as cooked: no pantry dialog, and the row shows Cooked, the thumbs and Undo.
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const undo = day.getByRole('button', { name: `Undo: ${meal!.name}` })
    await expect(undo).toBeFocused()
    await expect(day.getByText('Cooked', { exact: true })).toBeVisible()
    await expect(day.getByRole('button', { name: 'Thumbs up' })).toBeVisible()
    await expect
      .poll(async () => {
        const entry = (await listEntries(page)).entries.find((e) => e.id === entryId)
        return entry && { status: entry.status, charged: entry.pantryDeducted }
      })
      .toEqual({ status: 'completed', charged: true })

    // Undo, then Cooked: the log is already charged, so no dialog opens and the
    // PATCH asks for no deduction. Undo has landed once focus is on Cooked, so
    // the PATCH caught below is Cooked's.
    await undo.click()
    const cooked = day.getByRole('button', { name: 'Cooked' })
    await expect(cooked).toBeFocused()
    const [patch] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'PATCH' &&
          new URL(r.url()).pathname === `/api/meal-plans/${planId}/entries/${entryId}` &&
          r.request().postDataJSON()?.status === 'completed',
      ),
      cooked.click(),
    ])
    expect(patch.ok()).toBe(true)
    expect(patch.request().postDataJSON()).toEqual({ status: 'completed', deductPantry: false })
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(undo).toBeFocused()

    // A wrong log: Undo, then Remove, and the slot is empty with Add again.
    await undo.click()
    await day.getByRole('button', { name: 'Remove' }).click()
    await expect(add).toBeFocused()
    await expect
      .poll(async () => (await listEntries(page)).entries.some((e) => e.id === entryId))
      .toBe(false)
    entryId = null
  } finally {
    if (entryId) {
      await page.request.delete(`/api/meal-plans/${planId}/entries/${entryId}`).catch(() => {})
    }
  }
})

// The heading's "+ Add" logs a meal type the day does not expect (HON-1519).
// The smoke household expects dinner only, so breakfast is on the heading's
// menu, a submenu of the log routes. The log is one POST with
// `status: 'completed'`, and the new row above dinner takes focus.
test('a breakfast is logged on a dinner-only past day through the heading Add', async ({
  page,
}) => {
  await signInAsSmoke(page)

  const date = daysFromNow(HEADING_LOG_DAY_OFFSET)
  const { entries, planId } = await listEntries(page)
  expect(planId, 'The smoke household has no meal plan (prisma/seed.ts).').toBeTruthy()
  const stale = entries.find((e) => e.date === date && e.mealType === 'breakfast')
  if (stale) await page.request.delete(`/api/meal-plans/${planId}/entries/${stale.id}`)

  const mealsResponse = await page.request.get(
    '/api/meals?source=system&mealType=breakfast&limit=1',
  )
  expect(mealsResponse.ok()).toBe(true)
  const [meal] = ((await mealsResponse.json()) as { meals: MealSummary[] }).meals
  expect(meal, 'No seeded system breakfast').toBeTruthy()

  let entryId: string | null = null
  try {
    await page.goto('/past-meals')
    const add = headingLine(page, date).getByRole('button', { name: /^Add to / })
    await expect(add).not.toHaveAttribute('aria-describedby')

    await add.click()
    await expect
      .poll(async () => page.getByRole('menu').first().getByRole('menuitem').allTextContents())
      .toEqual(['Breakfast', 'Lunch'])
    await page.getByRole('menuitem', { name: 'Breakfast' }).click()
    await page
      .getByRole('menu', { name: 'Breakfast' })
      .getByRole('menuitem', { name: 'Choose a recipe' })
      .click()
    const dialog = page.getByRole('dialog', { name: 'Choose a recipe' })
    await dialog.getByRole('searchbox', { name: 'Search recipes' }).fill(meal!.name)

    const [post] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          new URL(r.url()).pathname === `/api/meal-plans/${planId}/entries`,
      ),
      dialog.getByRole('button', { name: meal!.name, exact: true }).first().click(),
    ])
    expect(post.ok()).toBe(true)
    expect(post.request().postDataJSON()).toEqual({
      date,
      mealType: 'breakfast',
      mealId: meal!.id,
      status: 'completed',
    })
    entryId = ((await post.json()) as { id: string }).id

    // The new breakfast row takes focus, above the day's dinner.
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const day = dayRows(page, date)
    await expect(day.getByRole('button', { name: `Undo: ${meal!.name}` })).toBeFocused()
    await expect(day).toHaveText(/Breakfast.*Dinner/)
    // Breakfast is covered now, so the heading's menu offers Lunch alone.
    await add.click()
    await expect(page.getByRole('group', { name: 'Lunch' })).toBeVisible()
    await page.keyboard.press('Escape')
  } finally {
    if (entryId) {
      await page.request.delete(`/api/meal-plans/${planId}/entries/${entryId}`).catch(() => {})
    }
  }
})
