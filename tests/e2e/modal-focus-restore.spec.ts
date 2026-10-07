// ROUTES: /profile, /, /sign-in · COMPONENTS: DeleteAccountDialog, AlertDialogTrigger, TimelineEmptySlot, MealCard, MealSelectorModal
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { signIn, signUpWithHousehold } from './utils/test-helpers'
import { e2eBaseURL } from './utils/db-helpers'
import { smokeFixture } from './utils/fixtures'

// The meal-card tests plant their own entries on this day. Past the shopping
// list's 7-day window, so a planned meal here never shows up in
// shopping-to-pantry's list, which shares the household and runs in parallel;
// inside Today's 14-day one, so the card renders.
const CARD_DAY_OFFSET = 10

interface EntrySummary {
  id: string
  date: string
  mealType: string
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
 * Creates a Today card on the fixed day and meal type, after clearing whatever
 * a crashed run left there. The note is what the test finds the card by: a
 * meal's name can repeat across the household's cards, a per-run note cannot.
 */
async function createCardEntry(
  request: APIRequestContext,
  mealType: 'breakfast' | 'dinner',
  fields: { mealId?: string; note: string },
): Promise<{ entryPath: string }> {
  const date = daysFromNow(CARD_DAY_OFFSET)
  // `endDate` is exclusive.
  const listResponse = await request.get(
    `/api/entries?startDate=${date}&endDate=${daysFromNow(CARD_DAY_OFFSET + 1)}`,
  )
  expect(listResponse.ok(), `GET /api/entries failed with ${listResponse.status()}`).toBe(true)
  const { entries, planId } = (await listResponse.json()) as {
    entries: EntrySummary[]
    planId: string | null
  }
  expect(
    planId,
    'The smoke household has no meal plan (prisma/seed.ts ensureSmokeMealPlan()).',
  ).toBeTruthy()

  const stale = entries.find((e) => e.date === date && e.mealType === mealType)
  if (stale) await request.delete(`/api/meal-plans/${planId}/entries/${stale.id}`)

  const createResponse = await request.post(`/api/meal-plans/${planId}/entries`, {
    data: { date, mealType, ...fields },
  })
  expect(createResponse.ok(), `Creating the entry failed with ${createResponse.status()}`).toBe(
    true,
  )
  const { id } = (await createResponse.json()) as { id: string }
  return { entryPath: `/api/meal-plans/${planId}/entries/${id}` }
}

// WHY: Focus-restore is a Radix Dialog/AlertDialog contract that depends on a
// real trigger and a real `.focus()` call, neither of which can be reliably
// simulated in the Storybook test-runner (see HON-443, HON-445). One Playwright
// test covers the invariant for all Radix modals in the app — this is not
// per-modal behaviour, so we don't replicate it for each dialog.
//
// The profile page's `DeleteAccountDialog` is chosen as the target because it
// is the most durable trigger/modal pair in the app: static UI (no AI, no
// generated content), reachable immediately after onboarding, and uses a plain
// `<AlertDialogTrigger>` pattern that doesn't risk re-rendering the trigger
// node when the dialog opens. The meal-card → `MealDetailModal` flow suggested
// in the original issue was rejected for this test because it depends on AI
// meal-plan generation, which is a real-world source of flakiness in CI.
test.describe('Modal focus-restore', () => {
  test('focus returns to the originating trigger after Escape-close', async ({ page }) => {
    await signUpWithHousehold(page)

    await page.goto('/profile')

    const trigger = page.getByRole('button', { name: 'Delete account' })
    await expect(trigger).toBeVisible()

    // Focus before click so Radix's FocusScope captures the trigger as the
    // element to restore focus to when the dialog closes. `click()` gives focus
    // in Chromium, but being explicit removes any race between the focus event
    // and Radix's mount-time activeElement snapshot.
    await trigger.focus()
    await expect(trigger).toBeFocused()

    await trigger.click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('data-state', 'open')

    // Close via Escape — the Radix path that must restore focus.
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()

    // The Radix contract: focus returns to the element that had it when the
    // dialog opened.
    await expect(trigger).toBeFocused()
  })

  // Not covered by the Radix contract above: the meal selector opens
  // programmatically once an empty slot's button has created a placeholder entry, with
  // no `DialogTrigger`, and a modal Radix dialog restores focus only to its
  // trigger. The slot hands it to its own button instead, which is still
  // pending (the placeholder DELETE is in flight), so the button must be
  // `aria-disabled` rather than `disabled` to take it (HON-803).
  //
  // Signs in as the seeded smoke fixture, whose household has a plan, so Today
  // renders empty slots with no AI plan generation (a fresh sign-up has no
  // plan). The selector's `/suggestions` call is a DB query, not an AI one.
  // Not `@smoke`: this file imports `signUpWithHousehold`, which
  // `scripts/check-smoke-specs.sh` rejects in a `@smoke` file.
  test('focus returns to the empty-slot button after the empty-slot selector is dismissed', async ({
    page,
  }) => {
    await signInAsSmoke(page)
    await page.goto('/')

    // The first empty slot is Today's: the seed plans nothing on the smoke
    // household, and past days hide their empty slots. The other specs that
    // share this household only touch today + 2 lunch (shopping-to-pantry) and
    // today + 10 (the card tests below), which a Today slot never is.
    const trigger = page.getByRole('button', { name: /: pick a meal,/ }).first()
    await expect(trigger).toBeVisible()

    let entryPath: string | null = null
    let discarded = false

    try {
      await trigger.focus()
      const [createResponse] = await Promise.all([
        page.waitForResponse(
          (r) =>
            r.request().method() === 'POST' &&
            /^\/api\/meal-plans\/[^/]+\/entries$/.test(new URL(r.url()).pathname),
        ),
        page.keyboard.press('Enter'),
      ])
      expect(
        createResponse.ok(),
        `Creating the placeholder failed with ${createResponse.status()}`,
      ).toBe(true)
      const { id } = (await createResponse.json()) as { id: string }
      entryPath = `${new URL(createResponse.url()).pathname}/${id}`

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()

      const [deleteResponse] = await Promise.all([
        page.waitForResponse(
          (r) => r.request().method() === 'DELETE' && new URL(r.url()).pathname === entryPath,
        ),
        page.keyboard.press('Escape'),
      ])
      discarded = deleteResponse.ok()
      await expect(dialog).toBeHidden()

      await expect(trigger).toBeFocused()
    } finally {
      // The close deletes the placeholder; clear it here only if it did not.
      if (entryPath && !discarded) {
        await page.request.delete(entryPath).catch(() => {})
      }
    }
  })

  // The card's two selectors open from state with no `DialogTrigger` either:
  // "Add meal" on an entry with no meal, and Swap from the card's more-actions
  // menu. Swap hands focus to the menu trigger, since the menu item it was
  // chosen from is gone by the time the selector closes (HON-804).
  test('focus returns to the card menu after the Swap selector is dismissed', async ({ page }) => {
    await signInAsSmoke(page)

    const mealsResponse = await page.request.get('/api/meals?source=system&limit=1')
    expect(mealsResponse.ok()).toBe(true)
    const { meals } = (await mealsResponse.json()) as { meals: { id: string; name: string }[] }
    const meal = meals[0]
    expect(meal, 'No seeded system meal to plan').toBeTruthy()

    const note = `e2e swap focus ${Date.now().toString(36)}`
    let entryPath: string | null = null

    try {
      ;({ entryPath } = await createCardEntry(page.request, 'dinner', {
        mealId: meal!.id,
        note,
      }))
      await page.goto('/')

      const card = page.locator('[data-slot="card"]').filter({ hasText: note })
      const trigger = card.getByRole('button', { name: `More actions: ${meal!.name}` })
      await trigger.focus()
      await page.keyboard.press('Enter')

      const swap = page.getByRole('menuitem', { name: 'Swap' })
      await swap.focus()
      await page.keyboard.press('Enter')

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()

      await expect(trigger).toBeFocused()
    } finally {
      if (entryPath) await page.request.delete(entryPath).catch(() => {})
    }
  })

  test('focus returns to "Add meal" after the card selector is dismissed', async ({ page }) => {
    await signInAsSmoke(page)

    const note = `e2e add focus ${Date.now().toString(36)}`
    let entryPath: string | null = null

    try {
      ;({ entryPath } = await createCardEntry(page.request, 'breakfast', { note }))
      await page.goto('/')

      const addMeal = page
        .locator('[data-slot="card"]')
        .filter({ hasText: note })
        .getByRole('button', { name: 'Add meal' })
      await addMeal.focus()
      await page.keyboard.press('Enter')

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()

      await expect(addMeal).toBeFocused()
    } finally {
      if (entryPath) await page.request.delete(entryPath).catch(() => {})
    }
  })
})
