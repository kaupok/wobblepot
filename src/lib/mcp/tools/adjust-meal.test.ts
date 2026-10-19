import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }))
vi.mock('@/lib/errors', () => ({ captureApiError: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { mealPlanEntry: { findFirst: vi.fn() } } }))
vi.mock('@/lib/feature-flags', () => ({ getServerFlag: vi.fn() }))
vi.mock('@/lib/ai/usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/usage')>()),
  assertUnderCap: vi.fn(),
}))
vi.mock('@/lib/meal-planning/adjust-entry', () => ({
  AdjustEntryError: class AdjustEntryError extends Error {
    constructor(readonly reason: string) {
      super(reason)
    }
  },
  loadAdjustContext: vi.fn(),
  proposeAdjustment: vi.fn(),
}))
vi.mock('@/lib/meal-plans/entry-changes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/entry-changes')>()),
  replaceEntryChanges: vi.fn(),
}))
vi.mock('@/lib/meal-plans/entry-context', () => ({ loadEntryForAi: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit'
import { getServerFlag } from '@/lib/feature-flags'
import { AiCostCapExceededError, assertUnderCap } from '@/lib/ai/usage'
import { loadAdjustContext, proposeAdjustment } from '@/lib/meal-planning/adjust-entry'
import type { AdjustProposal } from '@/lib/meal-planning/adjust-proposal'
import { EntryChangeError, replaceEntryChanges } from '@/lib/meal-plans/entry-changes'
import { loadEntryForAi } from '@/lib/meal-plans/entry-context'
import { mcpHousehold, READ_SCOPES, WRITE_SCOPES } from '@/test/mcp'
import { runTool, TOOL_FAILED_MESSAGE, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { adjustMeal } from './adjust-meal'

const household = mcpHousehold({ id: 'household-a' })
const ctx = { userId: 'user-a', household, scopes: WRITE_SCOPES }
const DATE = '2026-10-21'
const RESET_AT = new Date('2026-10-21T18:00:00.000Z')

function call(input: Record<string, unknown> = {}, caller = ctx) {
  return runTool(
    adjustMeal,
    caller,
    adjustMeal.inputSchema.parse({
      date: DATE,
      mealType: 'dinner',
      instruction: 'No cream, use yoghurt',
      ...input,
    }),
  )
}

const ingredient = (name: string) => ({
  name,
  defaultUnit: 'g',
  measuredByVolume: false,
  translations: [],
})
const component = (id: string, quantityPerServing: number) => ({
  ingredientId: id,
  quantityPerServing,
  isVague: false,
  originalPhrase: null,
  ingredient: ingredient(id),
})

function slot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    planId: 'plan-a',
    mealType: 'dinner',
    mealId: 'meal-pasta',
    status: 'planned',
    rating: null,
    servingOverride: null,
    meal: { id: 'meal-pasta', name: 'Cream pasta', timeMinutes: 25, primaryProteinType: null },
    ...overrides,
  }
}

/** A cream pasta for two, where the household already added chilli (change c1). */
const CONTEXT = {
  id: 'entry-1',
  planId: 'plan-a',
  status: 'planned',
  servingOverride: null,
  meal: {
    id: 'meal-pasta',
    components: [component('pasta', 100), component('cream', 50), component('mushroom', 40)],
  },
  changes: [
    {
      id: 'c1',
      originalIngredientId: null,
      replacementIngredientId: 'chilli',
      quantityPerServing: 2,
      replacementIngredient: ingredient('chilli'),
    },
  ],
  components: [
    component('pasta', 100),
    component('cream', 50),
    component('mushroom', 40),
    component('chilli', 2),
  ],
}

const yoghurt: AdjustProposal = {
  op: 'replace',
  original: { id: 'cream', name: 'cream' },
  originalIngredientId: 'cream',
  replacesChangeId: null,
  replacement: {
    matched: true,
    ingredient: { id: 'yoghurt', name: 'yoghurt', defaultUnit: 'g', measuredByVolume: false },
    quantityPerServing: 50,
  },
  reason: 'Yoghurt keeps it creamy.',
}
const noMushroom: AdjustProposal = {
  op: 'remove',
  original: { id: 'mushroom', name: 'mushroom' },
  originalIngredientId: 'mushroom',
  replacesChangeId: null,
  replacement: null,
  reason: 'Left out.',
}
const quark: AdjustProposal = {
  ...yoghurt,
  replacement: { matched: false, name: 'kohupiim', quantity: 50, unit: 'g' },
  reason: 'Quark is close.',
}

function proposes(changes: AdjustProposal[], followInSteps = false, notInMeal: string[] = []) {
  vi.mocked(proposeAdjustment).mockResolvedValue({
    changes,
    followInSteps,
    unmatched: [],
    notInMeal,
  })
}

const output = (result: Awaited<ReturnType<typeof call>>) =>
  result.structuredContent as Record<string, unknown>

describe('adjust_meal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: true,
      limit: 30,
      remaining: 29,
      resetAt: RESET_AT,
    })
    vi.mocked(prisma.mealPlanEntry.findFirst).mockResolvedValue(slot() as never)
    vi.mocked(loadAdjustContext).mockResolvedValue(CONTEXT as never)
    vi.mocked(getServerFlag).mockResolvedValue(true)
    vi.mocked(assertUnderCap).mockResolvedValue(undefined as never)
    vi.mocked(replaceEntryChanges).mockResolvedValue({ components: [] } as never)
    vi.mocked(loadEntryForAi).mockResolvedValue({
      ...CONTEXT,
      components: [component('pasta', 100), component('yoghurt', 50), component('chilli', 2)],
    } as never)
    proposes([yoghurt, noMushroom])
  })

  it('answers a read-only token with the reconnect message and reads nothing', async () => {
    const result = await call({}, { ...ctx, scopes: READ_SCOPES })

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: WRITE_SCOPE_MESSAGE }])
    expect(prisma.mealPlanEntry.findFirst).not.toHaveBeenCalled()
    expect(proposeAdjustment).not.toHaveBeenCalled()
  })

  it('applies the matched changes through the app’s whole-set write, with the instruction', async () => {
    const result = await call()

    expect(result.isError).toBeFalsy()
    expect(replaceEntryChanges).toHaveBeenCalledWith('household-a', 'plan-a', 'entry-1', {
      changes: [
        { originalIngredientId: null, replacementIngredientId: 'chilli', quantityPerServing: 2 },
        {
          originalIngredientId: 'cream',
          replacementIngredientId: 'yoghurt',
          quantityPerServing: 50,
        },
        {
          originalIngredientId: 'mushroom',
          replacementIngredientId: null,
          quantityPerServing: null,
        },
      ],
      basedOn: ['c1'],
      adjustmentNote: 'No cream, use yoghurt',
      noteMode: 'append',
    })
    expect(output(result)).toEqual({
      outcome: 'adjusted',
      date: DATE,
      mealType: 'dinner',
      meal: { id: 'meal-pasta', name: 'Cream pasta' },
      applied: [
        {
          op: 'replace',
          original: 'cream',
          replacement: 'yoghurt',
          quantityPerServing: 50,
          unit: 'g',
          reason: 'Yoghurt keeps it creamy.',
        },
        {
          op: 'remove',
          original: 'mushroom',
          replacement: null,
          quantityPerServing: null,
          unit: null,
          reason: 'Left out.',
        },
      ],
      unmatched: [],
      notInMeal: [],
      // At the household's two servings, read again after the write.
      ingredients: [
        { name: 'pasta', quantity: 200, unit: 'g', note: null },
        { name: 'yoghurt', quantity: 100, unit: 'g', note: null },
        { name: 'chilli', quantity: 4, unit: 'g', note: null },
      ],
    })
  })

  it('runs the pipeline with the household, the context, the instruction and the AI budget', async () => {
    await call()

    expect(proposeAdjustment).toHaveBeenCalledWith({
      household,
      context: CONTEXT,
      instruction: 'No cream, use yoghurt',
      locale: 'en',
      abortSignal: expect.any(AbortSignal),
    })
    expect(loadAdjustContext).toHaveBeenCalledWith('household-a', 'plan-a', 'entry-1', 'en')
  })

  it('reports an unmatched replacement and leaves it out of the write', async () => {
    proposes([quark, noMushroom])

    const result = await call()

    const written = vi.mocked(replaceEntryChanges).mock.calls[0]![3]
    expect(written.changes).toEqual([
      { originalIngredientId: null, replacementIngredientId: 'chilli', quantityPerServing: 2 },
      { originalIngredientId: 'mushroom', replacementIngredientId: null, quantityPerServing: null },
    ])
    expect(output(result).unmatched).toEqual([{ name: 'kohupiim', original: 'cream' }])
    expect(output(result).applied).toHaveLength(1)
  })

  it('reports an ingredient the meal does not have', async () => {
    proposes([noMushroom], false, ['bacon'])

    const result = await call({ instruction: 'No bacon or mushrooms' })

    expect(output(result).notInMeal).toEqual(['bacon'])
    expect(output(result).outcome).toBe('adjusted')
  })

  it('stores only the note when no ingredient changes but the steps should follow it', async () => {
    proposes([], true)

    const result = await call({ instruction: 'Less salt' })

    expect(replaceEntryChanges).toHaveBeenCalledWith('household-a', 'plan-a', 'entry-1', {
      changes: [
        { originalIngredientId: null, replacementIngredientId: 'chilli', quantityPerServing: 2 },
      ],
      basedOn: ['c1'],
      adjustmentNote: 'Less salt',
      noteMode: 'append',
    })
    expect(output(result).outcome).toBe('note_stored')
  })

  it('writes nothing and answers unchanged when nothing applies', async () => {
    proposes([quark])

    const result = await call()

    expect(replaceEntryChanges).not.toHaveBeenCalled()
    expect(loadEntryForAi).not.toHaveBeenCalled()
    expect(output(result)).toMatchObject({
      outcome: 'unchanged',
      applied: [],
      unmatched: [{ name: 'kohupiim', original: 'cream' }],
    })
    expect(output(result).ingredients).toEqual([
      { name: 'pasta', quantity: 200, unit: 'g', note: null },
      { name: 'cream', quantity: 100, unit: 'g', note: null },
      { name: 'mushroom', quantity: 80, unit: 'g', note: null },
      { name: 'chilli', quantity: 4, unit: 'g', note: null },
    ])
  })

  describe('refuses, with no model call and no write', () => {
    it.each([
      [
        'an empty slot',
        { mealId: null, meal: null },
        'The dinner on 2026-10-21 has no meal, so there are no ingredients to change. Use swap_meal to plan one. Nothing was changed.',
      ],
      [
        'a cooked entry',
        { status: 'completed' },
        'The dinner on 2026-10-21 was already cooked, so its ingredients cannot be changed. Use get_meal_plan to see the plan. Nothing was changed.',
      ],
      [
        'a skipped entry',
        { status: 'skipped' },
        'The dinner on 2026-10-21 was skipped, so its ingredients cannot be changed. Use get_meal_plan to see the plan. Nothing was changed.',
      ],
    ])('%s', async (_name, overrides, message) => {
      vi.mocked(prisma.mealPlanEntry.findFirst).mockResolvedValue(slot(overrides) as never)

      const result = await call()

      expect(result.isError).toBe(true)
      expect(result.content).toEqual([{ type: 'text', text: message }])
      expect(loadAdjustContext).not.toHaveBeenCalled()
      expect(proposeAdjustment).not.toHaveBeenCalled()
      expect(replaceEntryChanges).not.toHaveBeenCalled()
    })

    it('another household’s slot, which reads as no entry', async () => {
      vi.mocked(prisma.mealPlanEntry.findFirst).mockResolvedValue(null)

      const result = await call()

      expect(prisma.mealPlanEntry.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ plan: { householdId: 'household-a' } }),
        }),
      )
      expect(result.content).toEqual([
        {
          type: 'text',
          text: 'Nothing is planned for dinner on 2026-10-21. Use get_meal_plan to see which days and meals have an entry. Nothing was changed.',
        },
      ])
      expect(proposeAdjustment).not.toHaveBeenCalled()
    })

    it('the adjust-recipe limit, naming the reset time', async () => {
      vi.mocked(checkRateLimit).mockImplementation(async (_id, key) => ({
        allowed: key !== 'adjust-recipe',
        limit: 30,
        remaining: 0,
        resetAt: RESET_AT,
      }))

      const result = await call()

      expect(checkRateLimit).toHaveBeenCalledWith('household-a', 'adjust-recipe')
      expect(result.content).toEqual([
        {
          type: 'text',
          text: 'This household has asked for too many ingredient changes (at most 30 an hour). Try again after 2026-10-21T18:00:00.000Z. Nothing was changed.',
        },
      ])
      expect(proposeAdjustment).not.toHaveBeenCalled()
    })

    it('the AI kill switch, read with the user’s id', async () => {
      vi.mocked(getServerFlag).mockResolvedValue(false)

      const result = await call()

      expect(getServerFlag).toHaveBeenCalledWith('ai_generation_enabled', 'user-a')
      expect(result.content).toEqual([
        {
          type: 'text',
          text: 'Changes by AI are turned off in Wobblepot for now. Try again later. Nothing was changed.',
        },
      ])
      expect(proposeAdjustment).not.toHaveBeenCalled()
    })

    it('the cost cap, naming the reset day in the household’s timezone', async () => {
      vi.mocked(assertUnderCap).mockRejectedValue(
        new AiCostCapExceededError(new Date('2026-10-31T22:00:00.000Z'), 'Europe/Tallinn'),
      )

      const result = await call()

      expect(result.content).toEqual([
        {
          type: 'text',
          text: 'This household has used its AI allowance for this month. It resets on 2026-11-01. Nothing was changed.',
        },
      ])
      expect(proposeAdjustment).not.toHaveBeenCalled()
    })
  })

  it('asks for a new call when the changes moved while it ran', async () => {
    vi.mocked(replaceEntryChanges).mockRejectedValue(new EntryChangeError('changesMoved'))

    const result = await call()

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      {
        type: 'text',
        text: "The meal's ingredients changed while this ran. Call adjust_meal again. Nothing was changed.",
      },
    ])
  })

  it('answers the plain failure sentence when the model call fails', async () => {
    vi.mocked(proposeAdjustment).mockRejectedValue(new Error('overloaded'))

    const result = await call()

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: TOOL_FAILED_MESSAGE }])
    expect(replaceEntryChanges).not.toHaveBeenCalled()
  })

  it('refuses an instruction over 500 characters', () => {
    expect(() =>
      adjustMeal.inputSchema.parse({
        date: DATE,
        mealType: 'dinner',
        instruction: 'a'.repeat(501),
      }),
    ).toThrow()
  })
})
