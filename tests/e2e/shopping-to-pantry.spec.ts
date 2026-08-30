// ROUTES: /shopping, /sign-in · COMPONENTS: InventoryPage, ShoppingSection, ShoppingItem, PantrySection, PantryItem
import { test, expect, type APIRequestContext } from '@playwright/test'
import { signIn } from './utils/test-helpers'
import { e2eBaseURL } from './utils/db-helpers'
import { smokeFixture } from './utils/fixtures'

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

interface EntrySummary {
  id: string
  date: string
  mealType: string
}

interface MealComponent {
  ingredientId: string
  quantityPerServing: number
  isVague?: boolean
}

interface MealSummary {
  id: string
  name: string
  components: MealComponent[]
}

interface ShoppingListItem {
  ingredientId: string
  name: string
  purchased: boolean
}

function targetDate(): string {
  const date = new Date()
  date.setDate(date.getDate() + ENTRY_DAY_OFFSET)
  return date.toISOString().slice(0, 10)
}

async function listEntries(
  request: APIRequestContext,
): Promise<{ entries: EntrySummary[]; planId: string | null }> {
  const start = new Date()
  start.setDate(start.getDate() - 1)
  const end = new Date()
  end.setDate(end.getDate() + 9)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  const response = await request.get(`/api/entries?startDate=${fmt(start)}&endDate=${fmt(end)}`)
  expect(response.ok(), `GET /api/entries failed with ${response.status()}`).toBe(true)
  return (await response.json()) as { entries: EntrySummary[]; planId: string | null }
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

    try {
      const createResponse = await page.request.post(`/api/meal-plans/${planId}/entries`, {
        data: { date, mealType: ENTRY_MEAL_TYPE, mealId: meal!.id },
      })
      expect(
        createResponse.ok(),
        `Creating the fixture entry failed with ${createResponse.status()}`,
      ).toBe(true)
      entryId = ((await createResponse.json()) as { id: string }).id
      expect(entryId, 'Could not determine the id of the created entry').toBeTruthy()

      // Read the list from the API first: it already applies translation and
      // pantry-offset logic, so whatever it returns is exactly what the page
      // renders — no guessing which ingredient name to look for.
      const listResponse = await page.request.get('/api/shopping-list?days=7')
      expect(listResponse.ok()).toBe(true)
      const { groups } = (await listResponse.json()) as {
        groups: Array<{ items: ShoppingListItem[] }>
      }
      const target = groups.flatMap((g) => g.items).find((item) => !item.purchased)
      expect(
        target,
        'The shopping list is empty after adding a planned meal — the rolling-window computation ' +
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
      // panel that shares the /shopping page (there is no separate /pantry —
      // src/app/pantry/page.tsx redirects here). The per-row remove button
      // (`pantry.ariaRemove`) is the pantry's own accessible-name anchor, so
      // it can't be satisfied by the shopping-list row of the same name.
      const pantryRow = page.getByRole('button', { name: `Remove ${itemName}` })
      await expect(pantryRow).toBeVisible()

      // Data half: purchased items land with `quantity: null` — the "have some,
      // amount unknown" state (see /api/shopping-list/purchase).
      const pantryResponse = await page.request.get('/api/pantry')
      expect(pantryResponse.ok()).toBe(true)
      const { items } = (await pantryResponse.json()) as {
        items: Array<{ ingredient: { id: string }; quantity: number | null }>
      }
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

      const pantryAfter = await page.request.get('/api/pantry')
      const { items: itemsAfter } = (await pantryAfter.json()) as {
        items: Array<{ ingredient: { id: string } }>
      }
      expect(itemsAfter.some((i) => i.ingredient.id === purchasedIngredientId)).toBe(false)
      purchasedIngredientId = null
    } finally {
      // Leave the shared household exactly as found, whatever failed above.
      if (purchasedIngredientId) {
        await page.request
          .delete(`/api/pantry/by-ingredient/${purchasedIngredientId}`)
          .catch(() => {})
      }
      if (entryId) {
        await page.request.delete(`/api/meal-plans/${planId}/entries/${entryId}`).catch(() => {})
      }
    }
  })
})
