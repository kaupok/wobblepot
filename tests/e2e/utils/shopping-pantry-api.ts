import { type APIRequestContext, expect } from '@playwright/test'

/**
 * The API reads `shopping-to-pantry.spec.ts` checks the page against: the
 * shopping list, the pantry and the plan's entries, through the signed-in
 * page's `request` (HON-479). Their own file so the spec stays one flow an
 * agent can read whole.
 */

export interface EntrySummary {
  id: string
  date: string
  mealType: string
}

export interface MealComponent {
  ingredientId: string
  quantityPerServing: number
  isVague?: boolean
}

export interface MealSummary {
  id: string
  name: string
  components: MealComponent[]
}

export interface ShoppingListItem {
  ingredientId: string
  name: string
  purchased: boolean
  /** What to buy: the meals' need less the pantry's stock. */
  quantity: number
  /** A staple the household marked ran out (HON-1398). */
  restock: boolean
}

export interface PantryRow {
  ingredient: { id: string }
  quantity: number | null
}

export async function shoppingItems(request: APIRequestContext): Promise<ShoppingListItem[]> {
  const response = await request.get('/api/shopping-list?days=7')
  expect(response.ok()).toBe(true)
  const { groups } = (await response.json()) as { groups: Array<{ items: ShoppingListItem[] }> }
  return groups.flatMap((g) => g.items)
}

/** What the list says to buy of one ingredient; 0 when it is not listed. */
export const toBuy = (items: ShoppingListItem[], ingredientId: string) =>
  items.find((item) => item.ingredientId === ingredientId)?.quantity ?? 0

/** An ingredient name inside a `RegExp`, so "Rice (white)" matches as typed. */
export const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export async function pantryRows(request: APIRequestContext): Promise<PantryRow[]> {
  const response = await request.get('/api/pantry')
  expect(response.ok()).toBe(true)
  return ((await response.json()) as { items: PantryRow[] }).items
}

/**
 * A global ingredient the meal does not use and the pantry does not hold, to
 * replace one of the meal's with: a pantry row would cover it, so it would
 * never reach the list. Searched by a few common names, so the spec does not
 * depend on one seed row.
 */
export async function findReplacement(
  request: APIRequestContext,
  mealIngredientIds: Set<string>,
): Promise<{ id: string; name: string }> {
  const taken = new Set([
    ...mealIngredientIds,
    ...(await pantryRows(request)).map((row) => row.ingredient.id),
  ])
  for (const term of ['yoghurt', 'yogurt', 'tofu', 'lentil', 'chickpea', 'rice']) {
    const response = await request.get(`/api/ingredients?search=${term}`)
    expect(response.ok()).toBe(true)
    const { ingredients } = (await response.json()) as {
      ingredients: Array<{ id: string; name: string }>
    }
    const found = ingredients.find((i) => !taken.has(i.id))
    if (found) return found
  }
  throw new Error(
    'No seeded ingredient outside the meal and the pantry matched the replacement search terms.',
  )
}

export async function listEntries(
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
