import { describe, it, expect, vi, beforeEach } from 'vitest'

// The real resolve pipeline (`resolveProposals`, `buildChangeSet`), with the
// entry read, the catalogue and the write mocked: what this file asserts is
// how the named changes become the entry's new change set, and that nothing
// is written unless every change applies.

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

import { generateObject } from 'ai'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit'
import { assertUnderCap, recordAiUsage } from '@/lib/ai/usage'
import { matchIngredients } from '@/lib/ai/match-ingredients'
import { fuzzySearchIngredient } from '@/lib/ai/fuzzy-ingredient-match'
import { loadEntryForAi } from '@/lib/meal-plans/entry-context'
import { EntryChangeError, replaceEntryChanges } from '@/lib/meal-plans/entry-changes'
import { changeMealIngredients } from './change-meal-ingredients'
import {
  DATE,
  NO_CARROT,
  POTATO_RICE,
  TROUT,
  arrangeMocks,
  call,
  component,
  entry,
  errorText,
  output,
  row,
  slot,
} from './change-meal-ingredients.fixtures'

describe('change_meal_ingredients', () => {
  beforeEach(arrangeMocks)

  it('replaces the first named ingredient and leaves out the rest, per serving, without the AI', async () => {
    vi.mocked(loadEntryForAi)
      .mockResolvedValueOnce(entry() as never)
      .mockResolvedValueOnce(entry([POTATO_RICE, NO_CARROT]) as never)

    const result = await call([
      {
        action: 'replace',
        ingredients: ['potato', 'carrot'],
        with: 'rice',
        quantity: 300,
        unit: 'g',
      },
    ])

    expect(result.isError).toBeFalsy()
    // 300 g for 4 servings is 75 g a serving, matched alone at one serving.
    expect(matchIngredients).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'rice', quantity: 75, unit: 'g' })],
      1,
      { householdId: 'household-a', locale: 'en' },
    )
    expect(replaceEntryChanges).toHaveBeenCalledWith('household-a', 'plan-a', 'entry-1', {
      changes: [row('potato', 'rice', 75), row('carrot', null, null)],
      basedOn: [],
      adjustmentNote: null,
      noteMode: 'append',
    })
    expect(output(result)).toEqual({
      outcome: 'changed',
      date: DATE,
      mealType: 'dinner',
      meal: { id: 'meal-trout', name: 'Trout' },
      applied: [
        {
          action: 'replace',
          original: 'potato',
          replacement: 'rice',
          quantity: 300,
          unit: 'g',
          backToRecipe: false,
        },
        {
          action: 'leave_out',
          original: 'carrot',
          replacement: null,
          quantity: null,
          unit: null,
          backToRecipe: false,
        },
      ],
      unmatched: [],
      notInMeal: [],
      ambiguous: [],
      alreadyInMeal: [],
      note: null,
      notChanged: [],
      check: null,
      // Read again after the write, at the entry's 4 servings.
      ingredients: [
        { name: 'trout', quantity: 600, unit: 'g', note: null },
        { name: 'rice', quantity: 300, unit: 'g', note: null },
        { name: 'oil', quantity: 40, unit: 'g', note: null },
      ],
    })
    // Only the shared MCP limit: no adjust-recipe limit, no cost cap, no model.
    expect(vi.mocked(checkRateLimit).mock.calls).toEqual([['household-a', 'mcp']])
    expect(assertUnderCap).not.toHaveBeenCalled()
    expect(generateObject).not.toHaveBeenCalled()
    expect(recordAiUsage).not.toHaveBeenCalled()
  })

  it('keeps the earlier changes when it adds an ingredient', async () => {
    vi.mocked(loadEntryForAi).mockResolvedValue(entry([POTATO_RICE, NO_CARROT]) as never)

    await call([{ action: 'add', ingredient: 'broccoli', quantity: 400, unit: 'g' }])

    expect(replaceEntryChanges).toHaveBeenCalledWith('household-a', 'plan-a', 'entry-1', {
      changes: [row('potato', 'rice', 75), row('carrot', null, null), row(null, 'broccoli', 100)],
      basedOn: ['c1', 'c2'],
      adjustmentNote: null,
      noteMode: 'append',
    })
  })

  it('writes nothing when one replacement has no match, even if another change would apply', async () => {
    vi.mocked(fuzzySearchIngredient).mockResolvedValue([
      { id: 'rice', name: 'rice' },
      { id: 'risotto', name: 'risotto rice' },
    ] as never)

    const result = await call([
      { action: 'leave_out', ingredient: 'oil' },
      { action: 'replace', ingredients: ['potato'], with: 'xyzzy', quantity: 300, unit: 'g' },
    ])

    expect(replaceEntryChanges).not.toHaveBeenCalled()
    expect(output(result)).toMatchObject({
      outcome: 'not_changed',
      applied: [],
      unmatched: [{ name: 'xyzzy', alternatives: ['rice', 'risotto rice'] }],
    })
    expect(fuzzySearchIngredient).toHaveBeenCalledWith('xyzzy', {
      householdId: 'household-a',
      locale: 'en',
    })
  })

  it('counts a low-confidence match as no match', async () => {
    const result = await call([{ action: 'add', ingredient: 'quinoa', quantity: 200, unit: 'g' }])

    expect(replaceEntryChanges).not.toHaveBeenCalled()
    expect(output(result).unmatched).toEqual([{ name: 'quinoa', alternatives: [] }])
  })

  it('writes nothing for a name that fits several ingredients', async () => {
    const PEPPERS = [...TROUT, component('black pepper', 1), component('bell pepper', 60)]
    vi.mocked(loadEntryForAi).mockResolvedValue(entry([], PEPPERS) as never)

    const result = await call([{ action: 'leave_out', ingredient: 'pepper' }])

    expect(replaceEntryChanges).not.toHaveBeenCalled()
    expect(output(result)).toMatchObject({ outcome: 'not_changed', ambiguous: ['pepper'] })
  })

  it.each([
    [
      'an ingredient the meal does not have',
      { action: 'leave_out', ingredient: 'bacon' },
      { notInMeal: ['bacon'] },
    ],
    [
      'an ingredient the meal already has',
      { action: 'add', ingredient: 'carrot', quantity: 100, unit: 'g' },
      { alreadyInMeal: ['carrot'] },
    ],
    ['a restore no change fits', { action: 'restore', ingredient: 'oil' }, { notChanged: ['oil'] }],
  ])('writes nothing for %s', async (_label, item, lists) => {
    const result = await call([item])

    expect(replaceEntryChanges).not.toHaveBeenCalled()
    expect(output(result)).toMatchObject({ outcome: 'not_changed', applied: [], ...lists })
  })

  it('says it does not change an amount when a replace names the ingredient it replaces', async () => {
    vi.mocked(loadEntryForAi).mockResolvedValue(entry([POTATO_RICE]) as never)

    const result = await call([
      { action: 'replace', ingredients: ['rice'], with: 'rice', quantity: 300, unit: 'g' },
    ])

    expect(replaceEntryChanges).not.toHaveBeenCalled()
    expect(output(result)).toMatchObject({
      outcome: 'not_changed',
      applied: [],
      alreadyInMeal: ['rice'],
      note: expect.stringContaining('does not change an amount'),
    })
  })

  it('refuses two changes to the same ingredient', async () => {
    const result = await call([
      { action: 'replace', ingredients: ['potato'], with: 'rice', quantity: 300, unit: 'g' },
      { action: 'leave_out', ingredient: 'potato' },
    ])

    expect(replaceEntryChanges).not.toHaveBeenCalled()
    expect(errorText(result)).toBe(
      'Two of the changes name the same ingredient of this meal. Name each ingredient once and call again. Nothing was changed.',
    )
  })

  it('asks for a check when an amount crosses into pieces by a guess, and writes nothing', async () => {
    const result = await call([{ action: 'add', ingredient: 'egg', quantity: 100, unit: 'g' }])

    expect(replaceEntryChanges).not.toHaveBeenCalled()
    expect(output(result)).toMatchObject({
      outcome: 'check_quantity',
      applied: [],
      check: {
        name: 'egg',
        quantity: 100,
        unit: 'piece',
        warning:
          'Wobblepot does not know what one piece of egg weighs, so 100 g became 100 piece by a guess.',
      },
    })
  })

  it('matches an amount in ml as grams', async () => {
    await call([{ action: 'add', ingredient: 'milk', quantity: 400, unit: 'ml' }])

    expect(matchIngredients).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'milk', quantity: 100, unit: 'g' })],
      1,
      expect.anything(),
    )
    expect(vi.mocked(replaceEntryChanges).mock.calls[0]![3].changes).toEqual([
      row(null, 'milk', 100),
    ])
  })

  it.each([
    [
      'an empty slot',
      () =>
        vi
          .mocked(prisma.mealPlanEntry.findFirst)
          .mockResolvedValue(slot({ mealId: null, meal: null }) as never),
      `The dinner on ${DATE} has no meal, so there are no ingredients to change. Use swap_meal to plan one. Nothing was changed.`,
    ],
    [
      'a cooked meal',
      () =>
        vi
          .mocked(prisma.mealPlanEntry.findFirst)
          .mockResolvedValue(slot({ status: 'completed' }) as never),
      `The dinner on ${DATE} was already cooked, so its ingredients cannot be changed. Use get_meal_plan to see the plan. Nothing was changed.`,
    ],
    [
      'a skipped meal',
      () =>
        vi
          .mocked(prisma.mealPlanEntry.findFirst)
          .mockResolvedValue(slot({ status: 'skipped' }) as never),
      `The dinner on ${DATE} was skipped, so its ingredients cannot be changed. Use get_meal_plan to see the plan. Nothing was changed.`,
    ],
    [
      'a meal cooked before the entry read',
      () => vi.mocked(loadEntryForAi).mockResolvedValue(entry([], TROUT, 'completed') as never),
      `The dinner on ${DATE} changed while this ran, so its ingredients cannot be changed. Use get_meal_plan to see the plan. Nothing was changed.`,
    ],
  ])('refuses %s with the adjust_meal sentence', async (_label, arrange, message) => {
    arrange()

    const result = await call([{ action: 'leave_out', ingredient: 'oil' }])

    expect(result.isError).toBe(true)
    expect(errorText(result)).toBe(message)
    expect(replaceEntryChanges).not.toHaveBeenCalled()
  })

  it('asks for a new call when the changes moved while it ran', async () => {
    vi.mocked(replaceEntryChanges).mockRejectedValue(new EntryChangeError('changesMoved'))

    const result = await call([{ action: 'leave_out', ingredient: 'oil' }])

    expect(result.isError).toBe(true)
    expect(errorText(result)).toBe(
      "The meal's ingredients changed while this ran. Call change_meal_ingredients again. Nothing was changed.",
    )
  })

  it('refuses an amount over the per-serving limit, which the resolver would drop', async () => {
    const result = await call([{ action: 'add', ingredient: 'rice', quantity: 20004, unit: 'g' }])

    expect(replaceEntryChanges).not.toHaveBeenCalled()
    expect(errorText(result)).toBe(
      '20004 g of rice is more than 5000 g a serving. Check the amount and call again. Nothing was changed.',
    )
  })

  it('refuses changes that touch more than ten ingredients in all, which the resolver would cut', async () => {
    const result = await call([
      {
        action: 'replace',
        ingredients: ['a', 'b', 'c', 'd', 'e'],
        with: 'rice',
        quantity: 1,
        unit: 'g',
      },
      {
        action: 'replace',
        ingredients: ['f', 'g', 'h', 'i', 'j'],
        with: 'rice',
        quantity: 1,
        unit: 'g',
      },
      { action: 'leave_out', ingredient: 'k' },
    ])

    expect(replaceEntryChanges).not.toHaveBeenCalled()
    expect(errorText(result)).toBe(
      'These changes touch 11 ingredients; at most 10 can change in one call. Split them into two calls. Nothing was changed.',
    )
  })

  it('refuses a replace of more than five ingredients', () => {
    expect(() =>
      changeMealIngredients.inputSchema.parse({
        date: DATE,
        mealType: 'dinner',
        changes: [
          {
            action: 'replace',
            ingredients: ['a', 'b', 'c', 'd', 'e', 'f'],
            with: 'rice',
            quantity: 1,
            unit: 'g',
          },
        ],
      }),
    ).toThrow()
  })
})
