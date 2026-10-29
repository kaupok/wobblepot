// ROUTES: /shopping, /sign-in · COMPONENTS: InventoryPage, ShoppingSection, ShoppingListHeader, ShoppingItem, PantrySection, PantryItem, PantryAmountControl
// API: /api/meal-plans/[id]/entries/[entryId]/components (HON-1243)
import { type APIRequestContext, expect, test } from '@playwright/test'

import { e2eBaseURL } from './utils/db-helpers'
import { smokeFixture } from './utils/fixtures'
import {
  type EntrySummary,
  escapeRegExp,
  findReplacement,
  listEntries,
  type MealSummary,
  pantryRows,
  shoppingItems,
  toBuy,
} from './utils/shopping-pantry-api'
import { signIn } from './utils/test-helpers'

/**
 * Shopping list → mark purchased → pantry receives the item (HON-479).
 *
 * `@smoke`, pattern (b)-compatible (HON-560): no sign-up, no `/api/e2e-seed`.
 * It signs in as the seeded smoke fixture and works inside "Smoke Test
 * Household", which the seed also gives a `MealPlan` container.
 *
 * **Why the spec creates a plan entry.** The shopping list is derived purely
 * from `MealPlanEntry` rows dated within `[today, today + 7)`
 * (`computeRollingWindowShoppingList`), so an empty plan means an empty list
 * and nothing to purchase. Seeding an *entry* instead would work for a week
 * and then silently stop, reddening the promotion gate — so the date-bearing
 * fixture is created per run and deleted on teardown. The slot is fixed
 * (today + 2, lunch) rather than random so a crashed run leaves exactly one
 * known row for the next run to clear, instead of scattering leftovers.
 */

const ENTRY_DAY_OFFSET = 2
const ENTRY_MEAL_TYPE = 'lunch'

/** The entry's servings, pinned so the quantities below are exact. */
const ENTRY_SERVINGS = 2
/** The replacement's amount per serving, in its default unit. */
const REPLACEMENT_PER_SERVING = 50
/** What the deduction check stocks the replacement with. */
const STOCKED = 1000

function targetDate(): string {
  const date = new Date()
  date.setDate(date.getDate() + ENTRY_DAY_OFFSET)
  return date.toISOString().slice(0, 10)
}

/** Removes the fixture slot if a previous run died before its teardown. */
async function clearFixtureSlot(
  request: APIRequestContext,
  planId: string,
  entries: EntrySummary[],
  date: string,
): Promise<void> {
  const stale = entries.find((e) => e.date === date && e.mealType === ENTRY_MEAL_TYPE)
  if (stale) {
    await request.delete(`/api/meal-plans/${planId}/entries/${stale.id}`)
  }
}

test.describe('Shopping list → pantry handoff', { tag: '@smoke' }, () => {
  test('marking an item purchased moves it to the pantry, un-purchasing returns it', async ({
    page,
  }) => {
    // One test walks purchase, the window picker, "Ran out" and Complete, so it
    // needs more than the 30s default on a cold dev server (HON-1399 ran out of
    // it in teardown).
    test.setTimeout(90_000)
    const { email, password } = smokeFixture()

    // Pre-grant cookie consent so the bottom-fixed CookieBanner never
    // intercepts clicks — same rationale as signUp() in test-helpers.
    await page
      .context()
      .addCookies([{ name: 'consent-v1', value: 'essential', url: e2eBaseURL(), sameSite: 'Lax' }])
    await signIn(page, email, password)

    const date = targetDate()
    const { entries, planId } = await listEntries(page.request)
    // Deliberately a hard failure, not a skip: on remote tiers a silent skip
    // would green the promotion gate with no coverage (HON-560's rule for
    // missing fixtures). The message carries the backfill path instead.
    expect(
      planId,
      'The smoke household has no meal plan container (prisma/seed.ts ensureSmokeMealPlan(), new in HON-479). ' +
        'Tier 1 seeds it every run. On staging it appears once the "Deploy DB migrations [staging]" seed step ' +
        'has re-run (workflow_dispatch it to backfill); preview branches pick it up once they fork from the ' +
        're-seeded parent. Red here means the fixture is missing, not that the app broke.',
    ).not.toBeNull()

    await clearFixtureSlot(page.request, planId!, entries, date)

    // Pick a system meal with a concrete component, so the entry is guaranteed
    // to put a real quantity on the shopping list (vague components render but
    // aggregate to nothing purchasable).
    const mealsResponse = await page.request.get('/api/meals?source=system&limit=50')
    expect(mealsResponse.ok()).toBe(true)
    const { meals } = (await mealsResponse.json()) as { meals: MealSummary[] }
    const meal = meals.find((m) =>
      m.components?.some((c) => !c.isVague && c.quantityPerServing > 0),
    )
    expect(
      meal,
      'No seeded system meal exposes a concrete (non-vague, > 0) component — check prisma/seed.ts baseMeals.',
    ).toBeTruthy()

    let entryId: string | null = null
    let purchasedIngredientId: string | null = null
    // Pantry rows this run created, deleted on teardown.
    const createdPantryIds: string[] = []

    try {
      const createResponse = await page.request.post(`/api/meal-plans/${planId}/entries`, {
        data: {
          date,
          mealType: ENTRY_MEAL_TYPE,
          mealId: meal!.id,
          servingOverride: ENTRY_SERVINGS,
        },
      })
      expect(
        createResponse.ok(),
        `Creating the fixture entry failed with ${createResponse.status()}`,
      ).toBe(true)
      entryId = ((await createResponse.json()) as { id: string }).id
      expect(entryId, 'Could not determine the id of the created entry').toBeTruthy()

      // Replace one of the meal's ingredients on this entry only (HON-1243).
      // The list is read before and after, so other entries of the shared
      // household cannot skew the comparison.
      const before = await shoppingItems(page.request)
      // A concrete component this entry puts on the list, so its drop shows.
      const original = meal!.components.find(
        (c) => !c.isVague && c.quantityPerServing > 0 && toBuy(before, c.ingredientId) > 0,
      )
      expect(
        original,
        'None of the meal’s concrete ingredients is on the shopping list',
      ).toBeTruthy()
      const replacement = await findReplacement(
        page.request,
        new Set(meal!.components.map((c) => c.ingredientId)),
      )
      const changeResponse = await page.request.post(
        `/api/meal-plans/${planId}/entries/${entryId}/components`,
        {
          data: {
            originalIngredientId: original!.ingredientId,
            replacementIngredientId: replacement.id,
            quantityPerServing: REPLACEMENT_PER_SERVING,
          },
        },
      )
      expect(changeResponse.status(), 'Replacing the ingredient failed').toBe(201)

      // Read the list from the API first: it already applies translation and
      // pantry-offset logic, so whatever it returns is exactly what the page
      // renders — no guessing which ingredient name to look for.
      const after = await shoppingItems(page.request)
      // The replacement, at its amount times the entry's servings; the
      // original, by its own amount less.
      expect(toBuy(after, replacement.id)).toBe(
        toBuy(before, replacement.id) + REPLACEMENT_PER_SERVING * ENTRY_SERVINGS,
      )
      expect(toBuy(after, original!.ingredientId)).toBeCloseTo(
        Math.max(
          0,
          toBuy(before, original!.ingredientId) - original!.quantityPerServing * ENTRY_SERVINGS,
        ),
      )
      // Purchase the replacement: the item the change put on the list.
      const target = after.find((item) => item.ingredientId === replacement.id && !item.purchased)
      expect(
        target,
        'The replacement is not on the shopping list — the rolling-window computation ' +
          'or the entry date is out of the 7-day window.',
      ).toBeTruthy()

      purchasedIngredientId = target!.ingredientId
      const itemName = target!.name

      await page.goto('/shopping')
      await expect(page.getByRole('heading', { name: 'Shopping list' })).toBeVisible()

      // Role + accessible name (`shopping.ariaToggleItem`): survives layout
      // churn, fails loudly if the accessible name regresses.
      const toggle = page.getByRole('checkbox', { name: `Mark ${itemName} as purchased` })
      await expect(toggle).toBeVisible()

      const [purchaseResponse] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/api/shopping-list/purchase') && r.request().method() === 'POST',
        ),
        toggle.click(),
      ])
      expect(purchaseResponse.ok()).toBe(true)

      // User-visible half of the handoff: the item now appears in the pantry
      // column of the same page. At the suite's desktop width /shopping shows
      // both columns; on a phone the pantry is its own /pantry tab (HON-776),
      // which this spec does not exercise. The per-row remove button
      // (`pantry.ariaRemove`) is the pantry's own accessible-name anchor, so
      // it can't be satisfied by the shopping-list row of the same name.
      const pantryRow = page.getByRole('button', { name: `Remove ${itemName}` })
      await expect(pantryRow).toBeVisible()

      // Data half: purchased items land with `quantity: null` — the "have some,
      // amount unknown" state (see /api/shopping-list/purchase).
      const items = await pantryRows(page.request)
      const pantryItem = items.find((i) => i.ingredient.id === purchasedIngredientId)
      expect(pantryItem, `${itemName} did not reach the pantry`).toBeDefined()
      expect(pantryItem!.quantity).toBeNull()

      // Un-purchase: the pantry row goes away and the list item returns unchecked.
      const [unpurchaseResponse] = await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().includes('/api/shopping-list/unpurchase') && r.request().method() === 'POST',
        ),
        page.getByRole('checkbox', { name: `Mark ${itemName} as not purchased` }).click(),
      ])
      expect(unpurchaseResponse.ok()).toBe(true)

      await expect(pantryRow).toBeHidden()
      await expect(
        page.getByRole('checkbox', { name: `Mark ${itemName} as purchased` }),
      ).not.toBeChecked()

      const itemsAfter = await pantryRows(page.request)
      expect(itemsAfter.some((i) => i.ingredient.id === purchasedIngredientId)).toBe(false)
      purchasedIngredientId = null

      // HON-624: the 7/14-day window round-trips from the populated list.
      // Before the picker moved into the shared `ShoppingListHeader` it existed
      // only on the `nothing-needed` empty state, so widening to 14 days
      // surfaced items, swapped in `ShoppingSection`, and removed the only
      // control that could narrow it back — the user's escape was editing the
      // URL. Asserted here rather than in its own spec because it needs a
      // non-empty list, which this test's fixture entry already provides;
      // `fullyParallel` would otherwise race a second test on the shared
      // household. Non-destructive: only `?days=` and a `localStorage` key move.
      await expect(page.getByText('Next 7 days')).toBeVisible()

      const windowPicker = page.getByRole('combobox', { name: 'Time window' })
      await expect(windowPicker).toBeVisible()

      await windowPicker.click()
      await page.getByRole('option', { name: 'Next 14 days' }).click()
      await expect(page).toHaveURL(/[?&]days=14\b/)
      await expect(page.getByText('Next 14 days')).toBeVisible()
      // Still the populated list, not an empty state: widening can only add.
      await expect(
        page.getByRole('checkbox', { name: `Mark ${itemName} as purchased` }),
      ).toBeVisible()

      // Back again — the half that had no control at all before HON-624.
      await page.getByRole('combobox', { name: 'Time window' }).click()
      await page.getByRole('option', { name: 'Next 7 days' }).click()
      await expect(page).toHaveURL(/[?&]days=7\b/)
      await expect(page.getByText('Next 7 days')).toBeVisible()

      // An explicit `?days=` outranks the saved preference, so the Back button
      // works across the picker's own navigations. The stored window is now
      // '7'; going back lands on `?days=14`, and the mount reconcile has to
      // leave it alone. It did not before: the reconcile compared the stored
      // window against the rendered one with no way to tell an explicit URL
      // from a defaulted one, so it replaced its way straight back to 7 and
      // Back was a no-op. `?days=` presence is what `page.tsx` now threads
      // through as `windowDaysFromUrl`.
      await page.goBack()
      await expect(page).toHaveURL(/[?&]days=14\b/)
      await expect(page.getByText('Next 14 days')).toBeVisible()
      // Re-assert the URL after the effect has had a render to fire in: a
      // reconcile would have replaced it back to `?days=7` by now.
      await expect(page).toHaveURL(/[?&]days=14\b/)

      // A staple the household marks ran out goes on the list with no planned
      // meal (HON-1398), from one tap in the pantry beside it (HON-1399). The
      // API adds an ingredient no meal here uses, as an ordinary row; the
      // household stars it, then taps "Ran out".
      const staple = await findReplacement(
        page.request,
        new Set([...meal!.components.map((c) => c.ingredientId), replacement.id]),
      )
      const stapleResponse = await page.request.post('/api/pantry', {
        data: { ingredientId: staple.id, quantity: null },
      })
      expect(stapleResponse.status(), 'Adding the pantry row failed').toBe(201)
      createdPantryIds.push(staple.id)
      await page.reload()
      const ranOutButton = page.getByRole('button', { name: `Ran out: ${staple.name}` })
      // The innermost element holding both the row's "Ran out" and a star is the row.
      const pantryStapleRow = page
        .locator('div', { has: ranOutButton })
        .filter({ has: page.getByRole('button', { name: 'Mark as staple' }) })
        .last()
      await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/api/pantry/') && r.request().method() === 'PATCH',
        ),
        pantryStapleRow.getByRole('button', { name: 'Mark as staple' }).click(),
      ])
      await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/api/pantry/') && r.request().method() === 'PATCH',
        ),
        ranOutButton.click(),
      ])
      await expect(page.getByRole('button', { name: `Have it: ${staple.name}` })).toBeFocused()
      // No reload: the list beside the pantry re-reads on its own.
      const stapleRow = page.locator('label', {
        has: page.getByRole('checkbox', { name: `Mark ${staple.name} as purchased` }),
      })
      await expect(stapleRow).toContainText('Ran out')
      expect(
        (await shoppingItems(page.request)).find((item) => item.ingredientId === staple.id),
      ).toMatchObject({ quantity: 0, restock: true })

      // Completing the entry charges the replacement, never the original
      // (HON-1243). Stock both: the replacement through its pantry row below,
      // the original only when the household has no row for it, so an
      // existing row is only read.
      const stock = async (ingredientId: string) => {
        const response = await page.request.post('/api/pantry', {
          data: { ingredientId, quantity: STOCKED },
        })
        expect(response.status(), `Stocking ${ingredientId} failed`).toBe(201)
        createdPantryIds.push(ingredientId)
      }
      // The household enters the replacement's amount on its pantry row
      // (HON-1402), and the list beside it takes that much off, with no
      // reload. The row starts as "have some", as a purchase leaves it.
      const needBefore = toBuy(await shoppingItems(page.request), replacement.id)
      const replacementResponse = await page.request.post('/api/pantry', {
        data: { ingredientId: replacement.id, quantity: null },
      })
      expect(replacementResponse.status(), 'Adding the replacement row failed').toBe(201)
      createdPantryIds.push(replacement.id)
      await page.reload()
      await page.getByRole('button', { name: `Add amount: ${replacement.name}` }).click()
      await page.getByRole('textbox', { name: 'How much do you have?' }).fill(String(STOCKED))
      await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/api/pantry/') && r.request().method() === 'PATCH',
        ),
        page.getByRole('button', { name: 'Save' }).click(),
      ])
      await expect(
        page.getByRole('button', {
          name: new RegExp(`^Amount: ${escapeRegExp(replacement.name)}, ${STOCKED}`),
        }),
      ).toBeFocused()
      const remaining = Math.max(0, needBefore - STOCKED)
      expect(toBuy(await shoppingItems(page.request), replacement.id)).toBeCloseTo(remaining)
      if (remaining === 0) {
        await expect(
          page.getByRole('checkbox', {
            name: new RegExp(`^Mark ${escapeRegExp(replacement.name)} as`),
          }),
        ).toHaveCount(0)
      }
      const originalRow = (await pantryRows(page.request)).find(
        (row) => row.ingredient.id === original!.ingredientId,
      )
      if (!originalRow) await stock(original!.ingredientId)
      const originalBefore = originalRow ? originalRow.quantity : STOCKED

      const completeResponse = await page.request.patch(
        `/api/meal-plans/${planId}/entries/${entryId}`,
        { data: { status: 'completed', deductPantry: true } },
      )
      expect(completeResponse.ok(), 'Completing the entry failed').toBe(true)

      const pantryAfterCooking = await pantryRows(page.request)
      const quantityOf = (id: string) =>
        pantryAfterCooking.find((row) => row.ingredient.id === id)?.quantity
      expect(quantityOf(replacement.id)).toBe(STOCKED - REPLACEMENT_PER_SERVING * ENTRY_SERVINGS)
      expect(quantityOf(original!.ingredientId)).toBe(originalBefore)
    } finally {
      // Leave the shared household exactly as found, whatever failed above.
      for (const ingredientId of new Set([
        ...(purchasedIngredientId ? [purchasedIngredientId] : []),
        ...createdPantryIds,
      ])) {
        await page.request.delete(`/api/pantry/by-ingredient/${ingredientId}`).catch(() => {})
      }
      if (entryId) {
        await page.request.delete(`/api/meal-plans/${planId}/entries/${entryId}`).catch(() => {})
      }
    }
  })
})
