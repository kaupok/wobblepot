import { vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit'
import { matchIngredients } from '@/lib/ai/match-ingredients'
import { fuzzySearchIngredient } from '@/lib/ai/fuzzy-ingredient-match'
import { convertQuantity } from '@/lib/ai/recipe-quantities'
import { loadEntryForAi } from '@/lib/meal-plans/entry-context'
import { replaceEntryChanges } from '@/lib/meal-plans/entry-changes'
import { applyEntryChanges } from '@/lib/meal-planning/entry-components'
import { runTool } from '@/lib/mcp/context'
import { mcpHousehold, WRITE_SCOPES } from '@/test/mcp'
import { changeMealIngredients } from './change-meal-ingredients'

// Shared fixtures of the `change_meal_ingredients` tests: a planned trout for
// 4, its changes, the catalogue the mocked matcher reads, and the call. Each
// test file mocks the modules `arrangeMocks` sets up.

export const ingredient = (name: string, defaultUnit: 'g' | 'piece' = 'g') => ({
  name,
  defaultUnit,
  measuredByVolume: false,
  translations: [],
})
export const component = (id: string, quantityPerServing: number) => ({
  ingredientId: id,
  quantityPerServing,
  isVague: false,
  originalPhrase: null,
  ingredient: ingredient(id),
})
export const change = (
  id: string,
  original: string | null,
  replacement: string | null,
  quantityPerServing: number | null = null,
) => ({
  id,
  originalIngredientId: original,
  replacementIngredientId: replacement,
  quantityPerServing,
  replacementIngredient: replacement ? ingredient(replacement) : null,
})

export const TROUT = [
  component('trout', 150),
  component('potato', 200),
  component('carrot', 80),
  component('oil', 10),
]

/** A planned trout for 4, with `changes` applied as the read applies them. */
export function entry(
  changes: ReturnType<typeof change>[] = [],
  recipe = TROUT,
  status = 'planned',
) {
  return {
    id: 'entry-1',
    planId: 'plan-a',
    status,
    servingOverride: 4,
    cookedServings: null,
    leftoverItems: [],
    meal: { id: 'meal-trout', name: 'Trout', translations: [], components: recipe },
    changes,
    components: applyEntryChanges(recipe, changes),
  }
}

export function slot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    planId: 'plan-a',
    mealType: 'dinner',
    mealId: 'meal-trout',
    status: 'planned',
    rating: null,
    servingOverride: 4,
    cookedServings: null,
    leftoverItems: [],
    meal: { id: 'meal-trout', name: 'Trout', timeMinutes: 30, primaryProteinType: null },
    ...overrides,
  }
}

/** The catalogue: a name matches itself, `egg` is counted with no known weight. */
export const CATALOGUE: Record<string, { defaultUnit: 'g' | 'piece'; lowConfidence?: boolean }> = {
  rice: { defaultUnit: 'g' },
  potato: { defaultUnit: 'g' },
  broccoli: { defaultUnit: 'g' },
  carrot: { defaultUnit: 'g' },
  milk: { defaultUnit: 'g' },
  egg: { defaultUnit: 'piece' },
  peas: { defaultUnit: 'g' },
  quinoa: { defaultUnit: 'g', lowConfidence: true },
}

export const POTATO_RICE = change('c1', 'potato', 'rice', 75)
export const NO_CARROT = change('c2', 'carrot', null)
export const BROCCOLI = change('c3', null, 'broccoli', 100)

export const row = (
  original: string | null,
  replacement: string | null,
  quantity: number | null,
) => ({
  originalIngredientId: original,
  replacementIngredientId: replacement,
  quantityPerServing: quantity,
})

const household = mcpHousehold({ id: 'household-a' })
const ctx = { userId: 'user-a', household, scopes: WRITE_SCOPES }
export const DATE = '2026-10-21'

export function call(changes: unknown[]) {
  return runTool(
    changeMealIngredients,
    ctx,
    changeMealIngredients.inputSchema.parse({ date: DATE, mealType: 'dinner', changes }),
  )
}

export const output = (result: Awaited<ReturnType<typeof call>>) =>
  result.structuredContent as Record<string, unknown>
export const errorText = (result: Awaited<ReturnType<typeof call>>) =>
  (result.content as { text: string }[])[0]!.text

/** A planned trout for 4 with no changes, a write that succeeds, and the catalogue. */
export function arrangeMocks() {
  vi.clearAllMocks()
  vi.mocked(checkRateLimit).mockResolvedValue({
    allowed: true,
    limit: 60,
    remaining: 59,
    resetAt: new Date('2026-10-21T18:00:00.000Z'),
  })
  vi.mocked(prisma.mealPlanEntry.findFirst).mockResolvedValue(slot() as never)
  vi.mocked(loadEntryForAi).mockResolvedValue(entry() as never)
  vi.mocked(replaceEntryChanges).mockResolvedValue({ components: [] } as never)
  vi.mocked(fuzzySearchIngredient).mockResolvedValue([])
  vi.mocked(matchIngredients).mockImplementation(async ([wanted]) => {
    const known = CATALOGUE[wanted!.name]
    if (!known) return [{ type: 'unmatched' }] as never
    const found = { id: wanted!.name, name: wanted!.name, gramsPerPiece: null, ...known }
    return [
      {
        type: 'matched',
        ingredient: { ...found, measuredByVolume: false },
        convertedQuantity: convertQuantity(wanted!.quantity!, wanted!.unit!, found),
        lowConfidence: known.lowConfidence ?? false,
      },
    ] as never
  })
}
