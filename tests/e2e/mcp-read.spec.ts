// ROUTES: /api/mcp, /api/auth/oauth2/*, /consent · COMPONENTS: ConsentCard
import { test, expect, type Page } from '@playwright/test'
import { signIn } from './utils/test-helpers'
import { e2eBaseURL } from './utils/db-helpers'
import { smokeFixture } from './utils/fixtures'
import { connectMcpClient } from './utils/oauth'
import { mcpCall, mcpCallTool } from './utils/mcp'

/**
 * The read-only MCP server (HON-1151), called the way an MCP client calls it:
 * the OAuth flow from HON-1150 for a token, then `tools/list` and
 * `get_meal_plan` over Streamable HTTP.
 *
 * Tier 1 only. It signs in as the smoke fixture, whose household has a plan,
 * and plants its own entry so the plan read is not empty. No Claude call runs.
 */

// A day and slot of its own: the other fixture specs plant on days 10 and 12
// (meal-card-click, modal-focus-restore, note-placement), on day 11
// (mcp-write) and on day 2 (shopping-to-pantry), in the same household, in
// parallel.
const ENTRY_DAY_OFFSET = 13
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

/** Plants a planned meal on the spec's own day and slot; returns what to clean up. */
async function plantEntry(page: Page) {
  const date = daysFromNow(ENTRY_DAY_OFFSET)
  const listResponse = await page.request.get(
    `/api/entries?startDate=${daysFromNow(-1)}&endDate=${daysFromNow(16)}`,
  )
  expect(listResponse.ok()).toBe(true)
  const { entries, planId } = (await listResponse.json()) as {
    entries: { id: string; date: string; mealType: string; meal: { id: string } | null }[]
    planId: string | null
  }
  expect(planId, 'The smoke fixture household has a plan').toBeTruthy()

  // A run that died before its cleanup leaves its entry behind.
  const stale = entries.find((e) => e.date === date && e.mealType === MEAL_TYPE)
  if (stale) await page.request.delete(`/api/meal-plans/${planId}/entries/${stale.id}`)

  const mealsResponse = await page.request.get(`/api/meals?mealType=${MEAL_TYPE}&limit=20`)
  expect(mealsResponse.ok()).toBe(true)
  const { meals } = (await mealsResponse.json()) as { meals: { id: string; name: string }[] }
  const meal = meals[0]
  expect(meal, 'No seeded breakfast meal to plan').toBeTruthy()

  const createResponse = await page.request.post(`/api/meal-plans/${planId}/entries`, {
    data: { date, mealType: MEAL_TYPE, mealId: meal!.id },
  })
  expect(createResponse.ok(), await createResponse.text()).toBe(true)
  const { id: entryId } = (await createResponse.json()) as { id: string }
  return { date, meal: meal!, planId: planId!, entryId }
}

test.describe('MCP server', () => {
  test('refuses a request without a token and points at the resource metadata', async ({
    request,
  }) => {
    const response = await request.post('/api/mcp', {
      headers: { accept: 'application/json, text/event-stream' },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    })

    expect(response.status()).toBe(401)
    expect(response.headers()['www-authenticate']).toContain(
      '/.well-known/oauth-protected-resource',
    )
  })

  test("a connected client lists the tools and reads the household's plan", async ({
    page,
    request,
  }) => {
    await signInAsSmoke(page)
    const planted = await plantEntry(page)

    try {
      const token = await connectMcpClient(page, request)

      const list = (await mcpCall(request, token, 'tools/list')) as {
        tools: { name: string; annotations?: { readOnlyHint?: boolean } }[]
      }
      // A read-only token still lists the write tools (HON-1154), so the model
      // can tell the user to reconnect; see mcp-write.spec.ts.
      const readOnly = Object.fromEntries(
        list.tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint]),
      )
      expect(readOnly).toEqual({
        get_meal: true,
        get_household: true,
        get_meal_plan: true,
        get_pantry: true,
        get_shopping_list: true,
        list_meals: true,
        mark_purchased: false,
        add_shopping_item: false,
        check_shopping_item: false,
        set_pantry_status: false,
        set_staple: false,
        swap_meal: false,
        rate_meal: false,
        adjust_meal: false,
        change_meal_ingredients: false,
        create_meal: false,
        update_meal: false,
        plan_meal: false,
        plan_fridge_meal: false,
        add_extra: false,
        remove_extra: false,
        clear_meal: false,
        set_meal_status: false,
        set_meal_servings: false,
        remove_shopping_item: false,
        set_favourite: false,
        set_extra_amount: false,
        delete_meal: false,
        restore_meal: false,
      })

      const call = await mcpCallTool<{ entries: { mealId: string | null; mealType: string }[] }>(
        request,
        token,
        'get_meal_plan',
        { from: planted.date, to: planted.date },
      )
      expect(call.isError).toBeFalsy()
      expect(call.structuredContent!.entries.length).toBeGreaterThan(0)
      expect(call.structuredContent!.entries).toContainEqual(
        expect.objectContaining({ mealId: planted.meal.id, mealType: MEAL_TYPE }),
      )
    } finally {
      await page.request
        .delete(`/api/meal-plans/${planted.planId}/entries/${planted.entryId}`)
        .catch(() => {})
    }
  })
})
