// ROUTES: /past-meals · COMPONENTS: PastMealsList, PastMealRow, PantryDeductionModal, MealRatingInline, Header (User menu)
import { test, expect, type Page } from '@playwright/test'
import { signIn } from './utils/test-helpers'
import { e2eBaseURL } from './utils/db-helpers'
import { smokeFixture } from './utils/fixtures'

// A past day and slot of its own. The other specs on the smoke household plant
// only on today and later days, so nothing else writes here.
const PAST_DAY_OFFSET = -3
const MEAL_TYPE = 'dinner'

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

// The real page and the real PATCH: Cooked completes the entry, and the row
// and the rating survive a reload (HON-1018). The meal shares no ingredient
// with the pantry, so there is nothing to deduct and no dialog to confirm
// (HON-1125); the entry stays uncharged. The deduction dialog is covered by
// PastMealRow's tests and stories, the charge by pantry-deduction.spec.ts. The account menu's dot follows each
// status change through `router.refresh()`, with no reload (HON-1028). Unit
// tests and Storybook cover the row in isolation.
test('a past meal is marked cooked from its row in one click, and rated', async ({ page }) => {
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
    expect(patch.request().postDataJSON()).toEqual({ status: 'completed', deductPantry: false })
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

    // Persisted: completed, uncharged, and rated.
    await expect
      .poll(async () => {
        const entry = (await listEntries(page)).entries.find((e) => e.id === entryId)
        return (
          entry && { status: entry.status, charged: entry.pantryDeducted, rating: entry.rating }
        )
      })
      .toEqual({ status: 'completed', charged: false, rating: 'up' })

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
