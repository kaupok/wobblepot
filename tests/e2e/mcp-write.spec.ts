// ROUTES: /api/mcp, /api/auth/oauth2/*, /consent, /api/pantry, /api/entries, /api/meal-plans/*/entries · COMPONENTS: ConsentCard
import { test, expect, type Page } from '@playwright/test'
import { signIn, signUpWithHousehold } from './utils/test-helpers'
import { e2eBaseURL } from './utils/db-helpers'
import { smokeFixture } from './utils/fixtures'
import { connectMcpClient, WRITE_SCOPE } from './utils/oauth'
import { mcpCallTool } from './utils/mcp'

/**
 * The MCP write scope (HON-1154), driven the way an MCP client drives it:
 * consent with `mcp:write`, then `mark_purchased` puts an ingredient in the
 * pantry and takes it out again, and `swap_meal` and `rate_meal` change a
 * planned dinner and rate it once cooked (HON-1174), and `plan_fridge_meal`
 * plans a fridge meal the app reads back (HON-1281). A read-only token gets the reconnect message.
 *
 * Tier 1 only. The pantry tests sign up a household of their own, so its
 * pantry is empty and no other spec changes it in parallel. The meal plan
 * test needs a plan, which only the smoke fixture household has, so it plants
 * its own entry there. No Claude call runs.
 */

const WRITE_LINE =
  'Update your shopping list, pantry and meal plan, and add, change and delete recipes.'

/** A global ingredient id, from a system meal's components. */
async function anyIngredientId(page: Page): Promise<string> {
  const response = await page.request.get('/api/meals?source=system&limit=20')
  expect(response.ok()).toBe(true)
  const { meals } = (await response.json()) as {
    meals: { components?: { ingredientId: string }[] }[]
  }
  const ingredientId = meals.flatMap((meal) => meal.components ?? [])[0]?.ingredientId
  expect(ingredientId, 'No seeded system meal has a component').toBeTruthy()
  return ingredientId!
}

// A day and slot of its own on the smoke household: the other fixture specs
// plant on days 2, 10, 12 and 13, and on day -3 (past-meals).
const SWAP_DAY_OFFSET = 11
const SWAP_MEAL_TYPE = 'dinner'

function daysFromNow(offset: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return date.toISOString().slice(0, 10)
}

interface EntrySummary {
  id: string
  date: string
  mealType: string
  kind: string
  rating: string | null
  meal: { id: string } | null
  items: { label: string | null; name: string | null }[]
}

async function listEntries(page: Page) {
  const response = await page.request.get(
    `/api/entries?startDate=${daysFromNow(-1)}&endDate=${daysFromNow(16)}`,
  )
  expect(response.ok()).toBe(true)
  return (await response.json()) as { entries: EntrySummary[]; planId: string | null }
}

/** Plants a planned dinner on the spec's own day; returns what to clean up. */
async function plantDinner(page: Page) {
  const date = daysFromNow(SWAP_DAY_OFFSET)
  const { entries, planId } = await listEntries(page)
  expect(planId, 'The smoke fixture household has a plan').toBeTruthy()

  // A run that died before its cleanup leaves its entry behind.
  const stale = entries.find((e) => e.date === date && e.mealType === SWAP_MEAL_TYPE)
  if (stale) await page.request.delete(`/api/meal-plans/${planId}/entries/${stale.id}`)

  const mealsResponse = await page.request.get(`/api/meals?mealType=${SWAP_MEAL_TYPE}&limit=20`)
  expect(mealsResponse.ok()).toBe(true)
  const { meals } = (await mealsResponse.json()) as { meals: { id: string }[] }
  expect(meals[0], 'No seeded dinner to plan').toBeTruthy()

  const createResponse = await page.request.post(`/api/meal-plans/${planId}/entries`, {
    data: { date, mealType: SWAP_MEAL_TYPE, mealId: meals[0]!.id },
  })
  expect(createResponse.ok(), await createResponse.text()).toBe(true)
  const { id: entryId } = (await createResponse.json()) as { id: string }
  return { date, mealId: meals[0]!.id, planId: planId!, entryId }
}

async function plantedEntry(page: Page, entryId: string) {
  const entry = (await listEntries(page)).entries.find((e) => e.id === entryId)
  expect(entry, 'The planted entry is still there').toBeTruthy()
  return entry!
}

async function pantryIngredientIds(page: Page): Promise<string[]> {
  const response = await page.request.get('/api/pantry')
  expect(response.ok()).toBe(true)
  const { items } = (await response.json()) as { items: { ingredient: { id: string } }[] }
  return items.map((item) => item.ingredient.id)
}

test.describe('MCP write tools', () => {
  test('a client allowed to make changes marks an item purchased and undoes it', async ({
    page,
    request,
  }) => {
    await signUpWithHousehold(page, { householdName: 'MCP write E2E household' })
    const ingredientId = await anyIngredientId(page)
    expect(await pantryIngredientIds(page)).not.toContain(ingredientId)

    const token = await connectMcpClient(page, request, {
      scope: WRITE_SCOPE,
      onConsent: async (consentPage) => {
        await expect(consentPage.getByText(WRITE_LINE)).toBeVisible()
        await expect(consentPage.getByText('It cannot change anything in Wobblepot.')).toBeHidden()
      },
    })

    const bought = await mcpCallTool<{ items: { ingredientId: string; outcome: string }[] }>(
      request,
      token,
      'mark_purchased',
      { ingredientIds: [ingredientId], purchased: true },
    )
    expect(bought.isError, bought.content[0]?.text).toBeFalsy()
    expect(bought.structuredContent!.items).toEqual([{ ingredientId, outcome: 'in_pantry' }])
    // The same effect as the app's purchase: the ingredient is in the pantry.
    expect(await pantryIngredientIds(page)).toContain(ingredientId)

    const undone = await mcpCallTool<{ items: { ingredientId: string; outcome: string }[] }>(
      request,
      token,
      'mark_purchased',
      { ingredientIds: [ingredientId], purchased: false },
    )
    expect(undone.isError, undone.content[0]?.text).toBeFalsy()
    expect(undone.structuredContent!.items).toEqual([{ ingredientId, outcome: 'removed' }])
    expect(await pantryIngredientIds(page)).not.toContain(ingredientId)
  })

  test('a read-only client is told to reconnect and changes nothing', async ({ page, request }) => {
    await signUpWithHousehold(page)
    const ingredientId = await anyIngredientId(page)

    const token = await connectMcpClient(page, request, {
      onConsent: async (consentPage) => {
        await expect(consentPage.getByText(WRITE_LINE)).toBeHidden()
      },
    })

    const result = await mcpCallTool(request, token, 'mark_purchased', {
      ingredientIds: [ingredientId],
      purchased: true,
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('disconnect it and connect it again')
    expect(await pantryIngredientIds(page)).not.toContain(ingredientId)
  })

  test('a client allowed to make changes plans a fridge meal, and the app reads the same items', async ({
    page,
    request,
  }) => {
    // A household of its own, with no plan yet: the tool creates the plan row.
    await signUpWithHousehold(page)
    const ingredientId = await anyIngredientId(page)
    const token = await connectMcpClient(page, request, { scope: WRITE_SCOPE })
    const slot = { date: daysFromNow(1), mealType: 'dinner' }

    type FridgeItem = { name: string | null; source: string }
    const planned = await mcpCallTool<{ outcome: string; items: FridgeItem[] }>(
      request,
      token,
      'plan_fridge_meal',
      { ...slot, items: [{ ingredientId }, { label: 'Leftover mash' }] },
    )
    expect(planned.isError, planned.content[0]?.text).toBeFalsy()
    expect(planned.structuredContent!.outcome).toBe('planned')
    const items = planned.structuredContent!.items
    expect(items.map((item) => item.source)).toEqual(['pantry', 'text'])
    expect(items[1]!.name).toBe('Leftover mash')

    // The entry the app's card reads holds the same items, in the same order.
    const entry = (await listEntries(page)).entries.find(
      (e) => e.date === slot.date && e.mealType === slot.mealType,
    )
    expect(entry?.kind).toBe('fridge')
    expect(entry!.items.map((item) => item.label ?? item.name)).toEqual(
      items.map((item) => item.name),
    )

    const read = await mcpCallTool<{ entries: { kind: string; items: FridgeItem[] }[] }>(
      request,
      token,
      'get_meal_plan',
      { from: slot.date, to: slot.date },
    )
    expect(read.isError, read.content[0]?.text).toBeFalsy()
    expect(read.structuredContent!.entries).toEqual([
      expect.objectContaining({ kind: 'fridge', items }),
    ])
  })

  test('a client allowed to make changes swaps a planned dinner and rates it once cooked', async ({
    page,
    request,
  }) => {
    const { email, password } = smokeFixture()
    // Pre-grant consent so the CookieBanner cannot take focus or clicks.
    await page
      .context()
      .addCookies([{ name: 'consent-v1', value: 'essential', url: e2eBaseURL(), sameSite: 'Lax' }])
    await signIn(page, email, password)
    const planted = await plantDinner(page)
    const slot = { date: planted.date, mealType: SWAP_MEAL_TYPE }

    try {
      const token = await connectMcpClient(page, request, { scope: WRITE_SCOPE })

      type SwapOutput = {
        outcome: string
        meal: { id: string } | null
        suggestions: { id: string }[]
      }
      const offered = await mcpCallTool<SwapOutput>(request, token, 'swap_meal', slot)
      expect(offered.isError, offered.content[0]?.text).toBeFalsy()
      expect(offered.structuredContent!.outcome).toBe('suggestions')
      expect(offered.structuredContent!.meal?.id).toBe(planted.mealId)
      const suggestions = offered.structuredContent!.suggestions
      expect(suggestions.length, 'No suggestions for the planted dinner').toBeGreaterThan(0)
      expect(suggestions.map((s) => s.id)).not.toContain(planted.mealId)
      // Asking changes nothing.
      expect((await plantedEntry(page, planted.entryId)).meal?.id).toBe(planted.mealId)

      // A meal the suggestions would never offer is refused.
      const refused = await mcpCallTool(request, token, 'swap_meal', {
        ...slot,
        mealId: 'not-a-meal',
      })
      expect(refused.isError).toBe(true)
      expect((await plantedEntry(page, planted.entryId)).meal?.id).toBe(planted.mealId)

      const chosen = suggestions[0]!.id
      const swapped = await mcpCallTool<SwapOutput>(request, token, 'swap_meal', {
        ...slot,
        mealId: chosen,
      })
      expect(swapped.isError, swapped.content[0]?.text).toBeFalsy()
      expect(swapped.structuredContent!.outcome).toBe('swapped')
      // The same effect as the app's swap: the entry now names the chosen meal.
      expect((await plantedEntry(page, planted.entryId)).meal?.id).toBe(chosen)

      // The app shows the thumbs on a cooked meal only, and so does the tool.
      const early = await mcpCallTool(request, token, 'rate_meal', { ...slot, rating: 'up' })
      expect(early.isError).toBe(true)
      expect(early.content[0]?.text).toContain('set_meal_status')
      expect((await plantedEntry(page, planted.entryId)).rating).toBeNull()

      const cooked = await page.request.patch(
        `/api/meal-plans/${planted.planId}/entries/${planted.entryId}`,
        { data: { status: 'completed' } },
      )
      expect(cooked.ok(), await cooked.text()).toBe(true)

      const rated = await mcpCallTool(request, token, 'rate_meal', { ...slot, rating: 'up' })
      expect(rated.isError, rated.content[0]?.text).toBeFalsy()
      expect((await plantedEntry(page, planted.entryId)).rating).toBe('up')

      const cleared = await mcpCallTool(request, token, 'rate_meal', { ...slot, rating: null })
      expect(cleared.isError, cleared.content[0]?.text).toBeFalsy()
      expect((await plantedEntry(page, planted.entryId)).rating).toBeNull()
    } finally {
      await page.request
        .delete(`/api/meal-plans/${planted.planId}/entries/${planted.entryId}`)
        .catch(() => {})
    }
  })
})
