// ROUTES: / · COMPONENTS: MealCard, MealImageCard, NoteEditor, StickyNote
import { test, expect, type Locator, type Page } from '@playwright/test'
import { signIn } from './utils/test-helpers'
import { e2eBaseURL } from './utils/db-helpers'
import { smokeFixture } from './utils/fixtures'

// A day and slot of its own: modal-focus-restore plants its cards on day 10
// (breakfast and dinner) in the same household, in parallel. Inside Today's
// 14-day window, so the card renders.
const CARD_DAY_OFFSET = 12
const MEAL_TYPE = 'lunch'

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

/** The slip's place on its card, from the overlay that hugs it (not rotated). */
async function placeOnCard(card: Locator) {
  const [cardBox, overlayBox] = await Promise.all([
    card.boundingBox(),
    card.locator('[data-slot="meal-image-overlay"]').boundingBox(),
  ])
  expect(cardBox && overlayBox).toBeTruthy()
  return { left: overlayBox!.x - cardBox!.x, top: overlayBox!.y - cardBox!.y }
}

// The note's place is saved on the entry, so it survives a reload and is the
// same for everyone in the household (HON-975). Storybook covers the drag
// itself with synthetic events; this is the real pointer and the database.
test('a dragged note slip stays where it was dropped after a reload', async ({ page }) => {
  await signInAsSmoke(page)

  const date = daysFromNow(CARD_DAY_OFFSET)
  const listResponse = await page.request.get(
    `/api/entries?startDate=${date}&endDate=${daysFromNow(CARD_DAY_OFFSET + 1)}`,
  )
  expect(listResponse.ok()).toBe(true)
  const { entries, planId } = (await listResponse.json()) as {
    entries: { id: string; date: string; mealType: string }[]
    planId: string | null
  }
  expect(planId, 'The smoke household has no meal plan (prisma/seed.ts).').toBeTruthy()
  const stale = entries.find((e) => e.date === date && e.mealType === MEAL_TYPE)
  if (stale) await page.request.delete(`/api/meal-plans/${planId}/entries/${stale.id}`)

  const mealsResponse = await page.request.get('/api/meals?source=system&limit=1')
  expect(mealsResponse.ok()).toBe(true)
  const { meals } = (await mealsResponse.json()) as { meals: { id: string }[] }
  expect(meals[0], 'No seeded system meal to plan').toBeTruthy()

  const note = `e2e note place ${Date.now().toString(36)}`
  const createResponse = await page.request.post(`/api/meal-plans/${planId}/entries`, {
    data: { date, mealType: MEAL_TYPE, mealId: meals[0]!.id, note },
  })
  expect(createResponse.ok()).toBe(true)
  const { id: entryId } = (await createResponse.json()) as { id: string }
  const entryPath = `/api/meal-plans/${planId}/entries/${entryId}`

  try {
    await page.goto('/')
    const card = page.locator('[data-slot="card"]').filter({ hasText: note })
    const slip = card.getByRole('button', { name: note })
    await slip.scrollIntoViewIfNeeded()
    const before = await placeOnCard(card)

    const box = (await slip.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    const saved = page.waitForResponse(
      (response) => response.url().endsWith(entryPath) && response.request().method() === 'PATCH',
    )
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 40, y - 10, { steps: 8 })
    await page.mouse.up()
    expect((await saved).ok()).toBe(true)

    // Dropped, not opened.
    await expect(card.getByRole('textbox')).toHaveCount(0)
    const dropped = await placeOnCard(card)
    expect(dropped.left).toBeLessThan(before.left - 20)

    await page.reload()
    const reloaded = page.locator('[data-slot="card"]').filter({ hasText: note })
    await reloaded.getByRole('button', { name: note }).scrollIntoViewIfNeeded()
    await expect(reloaded.locator('[data-slot="meal-image-overlay"]')).toHaveAttribute(
      'data-placed',
      '',
    )
    const after = await placeOnCard(reloaded)
    expect(Math.abs(after.left - dropped.left)).toBeLessThanOrEqual(1)
    expect(Math.abs(after.top - dropped.top)).toBeLessThanOrEqual(1)
  } finally {
    await page.request.delete(entryPath).catch(() => {})
  }
})
