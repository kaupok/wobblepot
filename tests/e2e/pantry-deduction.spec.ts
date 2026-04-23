// ROUTES: /, /shopping · COMPONENTS: FirstTimeSetup, TimelineView, MealCard, PantryList
import { test, expect } from '@playwright/test'
import { signUpWithHousehold } from './utils/test-helpers'

// WHY: Large enough that `quantityPerServing × householdSize` can never deplete
// it to 0, so the deduction stays on the "update quantity" branch and the
// assertion is a simple subtraction.
const STARTING_QUANTITY = 10000

interface EntryComponent {
  ingredientId: string
  quantityPerServing: number
  isVague: boolean
  ingredient: {
    id: string
    name: string
  }
}

interface Entry {
  id: string
  meal: {
    id: string
    components: EntryComponent[]
  } | null
}

test.describe('Pantry deduction on meal completion', { tag: ['@smoke', '@ai'] }, () => {
  test.setTimeout(90_000)

  test('marking a meal completed decrements pantry by quantityPerServing × householdSize', async ({
    page,
  }) => {
    await signUpWithHousehold(page)

    // Generate the first meal plan from the FirstTimeSetup CTA on "/".
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /^Welcome to Honkadori/ })).toBeVisible()

    // Wait for the generate POST to resolve before reading /api/entries. Text-
    // based waits (e.g. "Today") don't work here: FirstTimeSetup itself
    // renders a "Today" start-date button, so the locator resolves pre-
    // generation and the subsequent entries fetch races the POST.
    const [generateResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/api/meal-plans/generate') && r.request().method() === 'POST',
        { timeout: 60_000 },
      ),
      page.getByRole('button', { name: 'Generate meal plan' }).click(),
    ])
    expect(generateResponse.ok()).toBe(true)

    // After a successful generate, FirstTimeSetup unmounts in favour of
    // TimelineView — wait for the Welcome heading to disappear so we know the
    // server-rendered plan has hydrated.
    await expect(page.getByRole('heading', { name: /^Welcome to Honkadori/ })).toBeHidden()

    // Discover plan + entries via API so we know a concrete ingredient and
    // quantityPerServing to drive the deduction assertion.
    const today = new Date()
    const windowStart = new Date(today)
    windowStart.setDate(windowStart.getDate() - 7)
    const windowEnd = new Date(today)
    windowEnd.setDate(windowEnd.getDate() + 15)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)

    const entriesResponse = await page.request.get(
      `/api/entries?startDate=${fmt(windowStart)}&endDate=${fmt(windowEnd)}`,
    )
    expect(entriesResponse.ok()).toBe(true)
    const { entries, planId } = (await entriesResponse.json()) as {
      entries: Entry[]
      planId: string | null
    }
    expect(planId).not.toBeNull()

    // Pick the first entry whose meal has a concrete (non-vague, > 0) component.
    let chosen: { entry: Entry; component: EntryComponent } | null = null
    for (const entry of entries) {
      if (!entry.meal) continue
      const component = entry.meal.components.find((c) => !c.isVague && c.quantityPerServing > 0)
      if (component) {
        chosen = { entry, component }
        break
      }
    }

    if (!chosen) {
      throw new Error(
        'No generated entry exposed a concrete (non-vague, > 0) ingredient. ' +
          'Re-run; AI generations vary. If persistent, investigate whether the seed ' +
          'meal catalogue only contains vague components.',
      )
    }

    const { entry, component } = chosen
    const ingredientId = component.ingredientId
    const ingredientName = component.ingredient.name
    const quantityPerServing = component.quantityPerServing

    // Fetch household size from the members endpoint so the test survives
    // changes to the default household-creation helper.
    const membersResponse = await page.request.get('/api/households/me/members')
    expect(membersResponse.ok()).toBe(true)
    const { members } = (await membersResponse.json()) as { members: unknown[] }
    const householdSize = members.length
    expect(householdSize).toBeGreaterThan(0)

    // Add the ingredient to the pantry via the UI on /shopping.
    await page.goto('/shopping')
    const addInput = page.getByPlaceholder('Add ingredient to pantry...')
    await addInput.fill(ingredientName)

    // Wait for the ingredient button in the dropdown, then click it and
    // capture the POST /api/pantry response so we get the new item's id.
    const resultButton = page
      .getByRole('button')
      .filter({ hasText: new RegExp(`^\\s*${escapeRegex(ingredientName)}\\b`, 'i') })
      .first()
    await expect(resultButton).toBeVisible({ timeout: 5_000 })

    const [postResponse] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith('/api/pantry') && r.request().method() === 'POST' && r.status() === 201,
      ),
      resultButton.click(),
    ])
    const created = (await postResponse.json()) as {
      id: string
      ingredient: { id: string }
    }
    const pantryItemId = created.id

    // The ingredient search is fuzzy (pg_trgm similarity). If the top hit
    // isn't the ingredient we targeted, fail loudly so the cause is obvious
    // rather than surfacing as a silent "pantry item missing" at the end.
    expect(
      created.ingredient.id,
      `UI search for "${ingredientName}" added ingredient ${created.ingredient.id} instead of the targeted ${ingredientId}`,
    ).toBe(ingredientId)

    // Set a known starting quantity via API (UI has no quantity editor).
    const patchPantryResponse = await page.request.patch(`/api/pantry/${pantryItemId}`, {
      data: { quantity: STARTING_QUANTITY },
    })
    expect(patchPantryResponse.ok()).toBe(true)
    const patchedPantry = (await patchPantryResponse.json()) as { quantity: number | null }
    expect(patchedPantry.quantity).toBe(STARTING_QUANTITY)

    // Mark the meal completed with pantry deduction. We hit the API directly
    // because MealCard's StatusSelect is only rendered for `isPast` days
    // (see src/components/meal-plan/MealCard.tsx), and "today" is not past —
    // so the UI path can't complete a freshly generated plan. The PATCH
    // endpoint is where the deduction logic lives; disabling it would still
    // be caught by the assertion below.
    const completeResponse = await page.request.patch(
      `/api/meal-plans/${planId}/entries/${entry.id}`,
      {
        data: { status: 'completed', deductPantry: true },
      },
    )
    expect(completeResponse.ok()).toBe(true)
    const completeBody = (await completeResponse.json()) as {
      status: string
      pantryDeducted?: boolean
    }
    expect(completeBody.status).toBe('completed')
    expect(completeBody.pantryDeducted).toBe(true)

    // Reload /shopping so the user-visible surface is exercised.
    await page.goto('/shopping')
    await expect(page.getByRole('heading', { name: 'Your pantry' })).toBeVisible()

    // Verify the exact remaining quantity via API. Exact match (no ranges)
    // per the acceptance criteria.
    const pantryAfterResponse = await page.request.get('/api/pantry')
    expect(pantryAfterResponse.ok()).toBe(true)
    const { items } = (await pantryAfterResponse.json()) as {
      items: Array<{ ingredient: { id: string }; quantity: number | null }>
    }
    const after = items.find((item) => item.ingredient.id === ingredientId)
    expect(after, `pantry item ${ingredientName} missing after completion`).toBeDefined()
    expect(after!.quantity).toBe(STARTING_QUANTITY - quantityPerServing * householdSize)
  })
})

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
