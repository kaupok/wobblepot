// ROUTES: / · COMPONENTS: TimelineDayCard, DayAddMenu, EmptySlotController, FridgeMealPicker, FridgeMealCard, MealCardMenu
import { expect, type Page, test } from '@playwright/test'

import { formatAbsoluteDate, formatDayLong } from '@/lib/i18n/format-dates'
import { parseLocalDate } from '@/lib/meal-planning/dates'

import { e2eBaseURL } from './utils/db-helpers'
import { smokeFixture } from './utils/fixtures'
import { signIn } from './utils/test-helpers'

// Any meal type on any day (HON-1518). The smoke household plans dinner only
// (prisma/seed.ts), so a breakfast sits under the day's other meal types. A
// day of its own: the other smoke-household specs plant on days 2, 4, 5 and 7
// to 13, and on days -3 and -5 (past-meals).
const DAY_OFFSET = 6
const MEAL_TYPE = 'breakfast'

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

async function breakfastsOn(page: Page, date: string) {
  // `endDate` is exclusive.
  const list = await page.request.get(
    `/api/entries?startDate=${date}&endDate=${daysFromNow(DAY_OFFSET + 1)}`,
  )
  expect(list.ok(), `GET /api/entries failed with ${list.status()}`).toBe(true)
  const { entries, planId } = (await list.json()) as {
    entries: { id: string; date: string; mealType: string }[]
    planId: string | null
  }
  return {
    planId,
    ids: entries.filter((e) => e.date === date && e.mealType === MEAL_TYPE).map((e) => e.id),
  }
}

test('a dinner-only household adds a breakfast from the Add menu, then clears it', async ({
  page,
}) => {
  await signInAsSmoke(page)

  const date = daysFromNow(DAY_OFFSET)
  const stale = await breakfastsOn(page, date)
  expect(stale.planId, 'The smoke household has no meal plan (prisma/seed.ts).').toBeTruthy()
  for (const id of stale.ids) {
    await page.request.delete(`/api/meal-plans/${stale.planId}/entries/${id}`)
  }

  const day = parseLocalDate(date)
  const add = page.getByRole('button', {
    name: `Add to ${formatDayLong(day, 'en')} ${formatAbsoluteDate(day, 'en')}`,
  })
  const item = `e2e toast ${Date.now().toString(36)}`

  try {
    await page.goto('/')
    await add.click()
    // Dinner's routes sit flat; Breakfast is a submenu after the separator.
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('group', { name: 'Dinner' })).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Breakfast' }).click()
    const breakfast = page.getByRole('menu', { name: 'Breakfast' })
    await breakfast.getByRole('menuitem', { name: 'Fridge meal' }).click()

    // The fridge route creates no placeholder: Save posts the entry.
    const picker = page.getByRole('dialog', { name: 'Fridge meal' })
    const search = picker.getByLabel('What are you having?')
    await search.fill(item)
    await search.press('Enter')
    await expect(picker.getByRole('region', { name: 'In this meal' })).toContainText(item)
    const [created] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          /^\/api\/meal-plans\/[^/]+\/entries$/.test(new URL(r.url()).pathname),
      ),
      picker.getByRole('button', { name: 'Save' }).click(),
    ])
    expect(created.ok(), `Saving the breakfast failed with ${created.status()}`).toBe(true)
    expect(created.request().postDataJSON()).toMatchObject({ date, mealType: MEAL_TYPE })
    await expect(picker).toHaveCount(0)

    // The breakfast is a normal card, and its ⋯ menu clears it.
    const more = page.getByRole('button', { name: `More actions: Fridge meal: ${item}` })
    await expect(more).toBeVisible()
    await more.click()
    await page.getByRole('menuitem', { name: 'Clear' }).click()
    await expect(more).toHaveCount(0)
    // Focus falls back to the day's "+ Add" (HON-1123).
    await expect(add).toBeFocused()
    await expect.poll(async () => (await breakfastsOn(page, date)).ids).toEqual([])
  } finally {
    const left = await breakfastsOn(page, date)
    for (const id of left.ids) {
      await page.request.delete(`/api/meal-plans/${left.planId}/entries/${id}`).catch(() => {})
    }
  }
})
