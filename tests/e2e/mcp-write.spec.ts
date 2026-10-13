// ROUTES: /api/mcp, /api/auth/oauth2/*, /consent, /api/pantry · COMPONENTS: ConsentCard
import { test, expect, type Page } from '@playwright/test'
import { signUpWithHousehold } from './utils/test-helpers'
import { connectMcpClient, WRITE_SCOPE } from './utils/oauth'
import { mcpCallTool } from './utils/mcp'

/**
 * The MCP write scope (HON-1154), driven the way an MCP client drives it:
 * consent with `mcp:write`, then `mark_purchased` puts an ingredient in the
 * pantry and takes it out again. A read-only token gets the reconnect message.
 *
 * Tier 1 only. Each test signs up a household of its own, so its pantry is
 * empty and no other spec changes it in parallel. No Claude call runs.
 */

const WRITE_LINE = 'Update your shopping list, pantry and meal plan.'

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
})
