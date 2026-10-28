import { describe, it, expect, vi, beforeEach } from 'vitest'

// The restore action (the app's Undo) and a replace that takes an ingredient
// back to the recipe, through the real resolve pipeline with the entry read,
// the catalogue and the write mocked, as in `change-meal-ingredients.test.ts`.

vi.mock('@/lib/env', () => ({ serverEnv: { ANTHROPIC_API_KEY: 'test-key' } }))
vi.mock('@/lib/errors', () => ({ captureApiError: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { mealPlanEntry: { findFirst: vi.fn() } } }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }))
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateObject: vi.fn(),
}))
vi.mock('@/lib/ai/usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/usage')>()),
  recordAiUsage: vi.fn(),
  assertUnderCap: vi.fn(),
}))
vi.mock('@/lib/ai/match-ingredients', () => ({ matchIngredients: vi.fn() }))
vi.mock('@/lib/ai/translate-match-results', () => ({
  translateMatchResults: vi.fn(async (results: unknown) => results),
  translateIngredientNames: vi.fn(async (ingredients: unknown) => ingredients),
}))
vi.mock('@/lib/ai/fuzzy-ingredient-match', () => ({ fuzzySearchIngredient: vi.fn() }))
vi.mock('@/lib/meal-plans/entry-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/entry-context')>()),
  loadEntryForAi: vi.fn(),
}))
vi.mock('@/lib/meal-plans/entry-changes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/entry-changes')>()),
  replaceEntryChanges: vi.fn(),
}))

import { loadEntryForAi } from '@/lib/meal-plans/entry-context'
import { replaceEntryChanges } from '@/lib/meal-plans/entry-changes'
import {
  BROCCOLI,
  NO_CARROT,
  POTATO_RICE,
  TROUT,
  arrangeMocks,
  call,
  change,
  component,
  entry,
  ingredient,
  output,
  row,
} from './change-meal-ingredients.fixtures'

describe('change_meal_ingredients: restore and back to the recipe', () => {
  beforeEach(arrangeMocks)

  it('restores a left-out ingredient by dropping its change, and keeps the others', async () => {
    vi.mocked(loadEntryForAi).mockResolvedValue(entry([POTATO_RICE, NO_CARROT, BROCCOLI]) as never)

    const result = await call([{ action: 'restore', ingredient: 'carrot' }])

    expect(replaceEntryChanges).toHaveBeenCalledWith('household-a', 'plan-a', 'entry-1', {
      changes: [row('potato', 'rice', 75), row(null, 'broccoli', 100)],
      basedOn: ['c1', 'c2', 'c3'],
      adjustmentNote: null,
      noteMode: 'append',
    })
    expect(output(result).applied).toEqual([
      {
        action: 'restore',
        original: 'carrot',
        replacement: null,
        quantity: null,
        unit: null,
        backToRecipe: false,
      },
    ])
  })

  it('restores a replaced ingredient by its recipe name, and an added one by its own', async () => {
    vi.mocked(loadEntryForAi).mockResolvedValue(entry([POTATO_RICE, NO_CARROT, BROCCOLI]) as never)

    await call([
      { action: 'restore', ingredient: 'potatoes' },
      { action: 'restore', ingredient: 'Broccoli' },
    ])

    expect(vi.mocked(replaceEntryChanges).mock.calls[0]![3].changes).toEqual([
      row('carrot', null, null),
    ])
  })

  it('restores an added ingredient and adds it again at a new amount in one call', async () => {
    vi.mocked(loadEntryForAi).mockResolvedValue(entry([POTATO_RICE, BROCCOLI]) as never)

    const result = await call([
      { action: 'restore', ingredient: 'broccoli' },
      { action: 'add', ingredient: 'broccoli', quantity: 200, unit: 'g' },
    ])

    // 200 g for 4 servings is 50 g a serving.
    expect(replaceEntryChanges).toHaveBeenCalledWith('household-a', 'plan-a', 'entry-1', {
      changes: [row('potato', 'rice', 75), row(null, 'broccoli', 50)],
      basedOn: ['c1', 'c3'],
      adjustmentNote: null,
      noteMode: 'append',
    })
    expect(output(result)).toMatchObject({
      outcome: 'changed',
      alreadyInMeal: [],
      applied: [
        { action: 'add', original: null, replacement: 'broccoli', quantity: 200, unit: 'g' },
        { action: 'restore', original: 'broccoli', replacement: null, quantity: null, unit: null },
      ],
    })
  })

  it('restores a replaced ingredient and adds its replacement in one call', async () => {
    vi.mocked(loadEntryForAi).mockResolvedValue(entry([POTATO_RICE]) as never)

    const result = await call([
      { action: 'restore', ingredient: 'potato' },
      { action: 'add', ingredient: 'rice', quantity: 200, unit: 'g' },
    ])

    expect(output(result).outcome).toBe('changed')
    expect(vi.mocked(replaceEntryChanges).mock.calls[0]![3].changes).toEqual([
      row(null, 'rice', 50),
    ])
  })

  it("reports the recipe's amount when a replace takes an ingredient back to the recipe", async () => {
    // The recipe has potato at 200 g a serving; the meal has rice instead.
    vi.mocked(loadEntryForAi)
      .mockResolvedValueOnce(entry([POTATO_RICE]) as never)
      .mockResolvedValueOnce(entry() as never)

    const result = await call([
      { action: 'replace', ingredients: ['rice'], with: 'potato', quantity: 500, unit: 'g' },
    ])

    // No row: the meal follows the recipe for potato, 200 g × 4 servings.
    expect(replaceEntryChanges).toHaveBeenCalledWith('household-a', 'plan-a', 'entry-1', {
      changes: [],
      basedOn: ['c1'],
      adjustmentNote: null,
      noteMode: 'append',
    })
    expect(output(result)).toMatchObject({
      outcome: 'changed',
      applied: [
        {
          action: 'replace',
          original: 'rice',
          replacement: 'potato',
          quantity: 800,
          unit: 'g',
          backToRecipe: true,
        },
      ],
      ingredients: expect.arrayContaining([
        { name: 'potato', quantity: 800, unit: 'g', note: null },
      ]),
    })
  })

  it('does not check the amount of an ingredient that goes back to the recipe', async () => {
    // Egg is counted with no known weight, so 100 g would need a check if it were saved.
    const EGGS = [...TROUT, { ...component('egg', 1), ingredient: ingredient('egg', 'piece') }]
    vi.mocked(loadEntryForAi).mockResolvedValue(
      entry([change('c4', 'egg', 'tofu', 50)], EGGS) as never,
    )

    const result = await call([
      { action: 'replace', ingredients: ['tofu'], with: 'egg', quantity: 100, unit: 'g' },
    ])

    expect(replaceEntryChanges).toHaveBeenCalled()
    expect(output(result)).toMatchObject({
      outcome: 'changed',
      check: null,
      applied: [{ replacement: 'egg', quantity: 4, unit: 'piece', backToRecipe: true }],
    })
  })

  it('restores a left-out ingredient and replaces it in one call', async () => {
    vi.mocked(loadEntryForAi).mockResolvedValue(entry([NO_CARROT]) as never)

    const result = await call([
      { action: 'restore', ingredient: 'carrot' },
      { action: 'replace', ingredients: ['carrot'], with: 'peas', quantity: 320, unit: 'g' },
    ])

    expect(output(result).outcome).toBe('changed')
    expect(vi.mocked(replaceEntryChanges).mock.calls[0]![3].changes).toEqual([
      row('carrot', 'peas', 80),
    ])
  })

  it.each([
    ['leaves out', { action: 'leave_out', ingredient: 'rice' }],
    [
      'replaces',
      { action: 'replace', ingredients: ['rice'], with: 'broccoli', quantity: 300, unit: 'g' },
    ],
  ])('writes nothing for a restore and a change that %s its replacement', async (_label, item) => {
    vi.mocked(loadEntryForAi).mockResolvedValue(entry([POTATO_RICE]) as never)

    const result = await call([{ action: 'restore', ingredient: 'potato' }, item])

    // After the restore the meal has potato again, not rice.
    expect(replaceEntryChanges).not.toHaveBeenCalled()
    expect(output(result)).toMatchObject({ outcome: 'not_changed', notInMeal: ['rice'] })
  })
})
