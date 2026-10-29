import { beforeEach, describe, expect, it, vi } from 'vitest'

// The pipeline behind `POST .../adjust` (HON-1244), with the model, the entry
// read and the catalogue match mocked: what this file asserts is the prompt
// the model gets, the usage it records, and how its answer becomes proposals.

vi.mock('@/lib/env', () => ({ serverEnv: { ANTHROPIC_API_KEY: 'test-key' } }))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => (modelId: string) => ({ modelId })),
}))

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateObject: vi.fn(),
}))

vi.mock('@/lib/meal-plans/entry-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/entry-context')>()),
  loadEntryForAi: vi.fn(),
  loadPantryNamesForAi: vi.fn(),
}))

vi.mock('@/lib/ai/match-ingredients', () => ({ matchIngredients: vi.fn() }))
vi.mock('@/lib/ai/translate-match-results', () => ({
  translateMatchResults: vi.fn(async (results: unknown) => results),
}))

vi.mock('@/lib/ai/usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/usage')>()),
  recordAiUsage: vi.fn(),
}))

import { generateObject } from 'ai'

import { matchIngredients } from '@/lib/ai/match-ingredients'
import { ADJUST_MODEL } from '@/lib/ai/models'
import { recordAiUsage } from '@/lib/ai/usage'
import {
  EntryContextError,
  loadEntryForAi,
  loadPantryNamesForAi,
} from '@/lib/meal-plans/entry-context'

import {
  type AdjustContext,
  AdjustEntryError,
  loadAdjustContext,
  proposeAdjustment,
  resolveProposals,
} from './adjust-entry'

const mockGenerate = vi.mocked(generateObject)
const mockLoad = vi.mocked(loadEntryForAi)
const mockPantry = vi.mocked(loadPantryNamesForAi)
const mockMatch = vi.mocked(matchIngredients)

const ingredient = (name: string, defaultUnit: 'g' | 'piece' = 'g') => ({
  name,
  defaultUnit,
  measuredByVolume: false,
  translations: [],
})
const component = (ingredientId: string, quantityPerServing: number) => ({
  ingredientId,
  quantityPerServing,
  isVague: false,
  originalPhrase: null,
  ingredient: ingredient(ingredientId),
})

/** A planned cream pasta with mushrooms for two, nothing changed yet. */
const entry = {
  id: 'entry-1',
  status: 'planned',
  servingOverride: 2,
  cookedServings: null,
  leftoverItems: [],
  changes: [],
  meal: {
    name: 'Cream pasta',
    translations: [],
    components: [component('pasta', 100), component('cream', 50), component('mushroom', 40)],
  },
  components: [component('pasta', 100), component('cream', 50), component('mushroom', 40)],
}

const household = {
  id: 'household-1',
  members: [],
  preferences: {
    allergensToAvoid: ['peanuts'],
    dietaryType: null,
    excludedIngredients: [],
    restrictions: [],
  },
}

const matched = (id: string, convertedQuantity: number, lowConfidence = false) => ({
  type: 'matched',
  ingredient: { id, name: id, defaultUnit: 'g', measuredByVolume: false },
  convertedQuantity,
  lowConfidence,
})

function answer(changes: unknown[], followInSteps = false) {
  mockGenerate.mockResolvedValue({
    object: { changes, followInSteps },
    usage: { inputTokens: 900, outputTokens: 120, totalTokens: 1020 },
  } as never)
}

const propose = () =>
  proposeAdjustment({
    household,
    context: entry as unknown as AdjustContext,
    instruction: 'No cream, I have yoghurt',
    locale: 'en',
    abortSignal: new AbortController().signal,
  })

describe('proposeAdjustment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPantry.mockResolvedValue([
      { isStaple: false, ingredient: { name: 'yoghurt', translations: [] } },
    ] as never)
  })

  it('sends the merged meal, the pantry, the restrictions and the instruction to the adjust model', async () => {
    answer([])

    await propose()

    const request = mockGenerate.mock.calls[0]![0] as { prompt: string; model: unknown }
    expect(request.model).toEqual({ modelId: ADJUST_MODEL })
    expect(request.prompt).toContain('- cream: 50g per serving')
    expect(request.prompt).toContain('Servings: 2')
    expect(request.prompt).toContain('- yoghurt')
    expect(request.prompt).toContain('peanuts')
    expect(request.prompt).toContain('<<<\nNo cream, I have yoghurt\n>>>')
    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: 'household-1', feature: 'adjust_recipe' }),
    )
  })

  it('returns a matched replace with its per-serving amount', async () => {
    answer([
      {
        op: 'replace',
        original: 'cream',
        replacement: 'yoghurt',
        quantityPerServing: 50,
        unit: 'g',
        reason: 'Yoghurt keeps it creamy.',
      },
    ])
    mockMatch.mockResolvedValue([matched('yoghurt', 50)] as never)

    expect(await propose()).toEqual({
      changes: [
        {
          op: 'replace',
          original: { id: 'cream', name: 'cream' },
          originalIngredientId: 'cream',
          replacesChangeId: null,
          replacement: {
            matched: true,
            ingredient: {
              id: 'yoghurt',
              name: 'yoghurt',
              defaultUnit: 'g',
              measuredByVolume: false,
            },
            quantityPerServing: 50,
          },
          reason: 'Yoghurt keeps it creamy.',
        },
      ],
      followInSteps: false,
      unmatched: [],
      notInMeal: [],
      ambiguous: [],
    })
    // Matched alone, at one serving: the amount is already per serving.
    expect(mockMatch).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'yoghurt', quantity: 50, unit: 'g' })],
      1,
      { householdId: 'household-1', locale: 'en' },
    )
  })

  it('reports a low-confidence or missing match as unmatched, with the model’s amount', async () => {
    answer([
      {
        op: 'add',
        original: null,
        replacement: 'gochujang',
        quantityPerServing: 5,
        unit: 'g',
        reason: 'Heat.',
      },
      {
        op: 'add',
        original: null,
        replacement: 'chilli',
        quantityPerServing: 1,
        unit: 'g',
        reason: 'Heat.',
      },
    ])
    mockMatch
      .mockResolvedValueOnce([{ type: 'unmatched' }] as never)
      .mockResolvedValueOnce([matched('chilli-sauce', 1, true)] as never)

    const result = await propose()

    expect(result.unmatched).toEqual(['gochujang', 'chilli'])
    expect(result.changes.map((c) => c.replacement)).toEqual([
      { matched: false, name: 'gochujang', quantity: 5, unit: 'g' },
      { matched: false, name: 'chilli', quantity: 1, unit: 'g' },
    ])
  })

  it('drops a change the apply would refuse, or one that changes nothing', async () => {
    answer([
      {
        op: 'add',
        original: null,
        replacement: 'pasta',
        quantityPerServing: 20,
        unit: 'g',
        reason: 'More.',
      },
      {
        op: 'add',
        original: null,
        replacement: 'basil',
        quantityPerServing: 2,
        unit: 'g',
        reason: 'Fresh.',
      },
      {
        op: 'replace',
        original: 'mushroom',
        replacement: 'basil',
        quantityPerServing: 2,
        unit: 'g',
        reason: 'Fresh.',
      },
      {
        op: 'remove',
        original: 'beef',
        replacement: null,
        quantityPerServing: null,
        unit: null,
        reason: 'No.',
      },
      {
        op: 'replace',
        original: 'cream',
        replacement: 'cream',
        quantityPerServing: 50,
        unit: 'g',
        reason: 'Same.',
      },
    ])
    mockMatch.mockImplementation(async ([wanted]) => [matched(wanted!.name, 2)] as never)

    const result = await propose()

    expect(
      result.changes.map((c) => [c.op, c.replacement?.matched && c.replacement.ingredient.id]),
    ).toEqual([['add', 'basil']])
  })

  it('returns an empty list as the model sent it, with its steps flag', async () => {
    answer([], true)

    expect(await propose()).toEqual({
      changes: [],
      followInSteps: true,
      unmatched: [],
      notInMeal: [],
      ambiguous: [],
    })
    expect(mockMatch).not.toHaveBeenCalled()
  })

  it('reports an original the meal does not have, and drops its change', async () => {
    answer([
      {
        op: 'remove',
        original: 'bacon',
        replacement: null,
        quantityPerServing: null,
        unit: null,
        reason: 'No meat.',
      },
    ])

    const result = await propose()

    expect(result.changes).toEqual([])
    expect(result.notInMeal).toEqual(['bacon'])
  })
})

describe('resolveProposals', () => {
  beforeEach(() => vi.clearAllMocks())

  const resolve = (changes: unknown[]) =>
    resolveProposals(
      changes as Parameters<typeof resolveProposals>[0],
      entry as unknown as AdjustContext,
      'household-1',
      'en',
    )
  const named = (
    op: 'replace' | 'remove' | 'add',
    original: string | null,
    replacement: string | null = null,
  ) => ({
    op,
    original,
    replacement,
    quantityPerServing: replacement ? 20 : null,
    unit: replacement ? 'g' : null,
    reason: '',
  })

  it('resolves named changes without a model call, with the catalogue match behind each', async () => {
    mockMatch.mockImplementation(async ([wanted]) => [matched(wanted!.name, 20)] as never)

    const result = await resolve([
      named('replace', 'cream', 'yoghurt'),
      named('remove', 'mushroom'),
    ])

    expect(mockGenerate).not.toHaveBeenCalled()
    expect(result.changes.map((c) => [c.op, c.original?.id, c.replacement?.matched])).toEqual([
      ['replace', 'cream', true],
      ['remove', 'mushroom', undefined],
    ])
    expect(result.matches.get(result.changes[0]!)).toMatchObject({
      ingredient: { id: 'yoghurt' },
      convertedQuantity: 20,
    })
    expect(result.matches.has(result.changes[1]!)).toBe(false)
    expect(result).toMatchObject({ unmatched: [], notInMeal: [], ambiguous: [], alreadyInMeal: [] })
  })

  it('names a replacement the meal already has, or one another change brings in', async () => {
    mockMatch.mockImplementation(async ([wanted]) => [matched(wanted!.name, 20)] as never)

    const result = await resolve([
      named('add', null, 'pasta'),
      named('add', null, 'basil'),
      named('replace', 'cream', 'basil'),
    ])

    expect(result.changes.map((c) => c.op)).toEqual(['add'])
    expect(result.alreadyInMeal).toEqual(['pasta', 'basil'])
  })

  it('reports unmatched, missing and unknown names', async () => {
    mockMatch.mockResolvedValue([{ type: 'unmatched' }] as never)

    const result = await resolve([named('add', null, 'xyzzy'), named('remove', 'bacon')])

    expect(result).toMatchObject({ unmatched: ['xyzzy'], notInMeal: ['bacon'], ambiguous: [] })
  })
})

describe('loadAdjustContext', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    [
      'an entry of another household',
      () => mockLoad.mockRejectedValue(new EntryContextError('not_found')),
      'not_found',
    ],
    [
      'an empty slot',
      () => mockLoad.mockResolvedValue({ ...entry, meal: null } as never),
      'no_meal',
    ],
    [
      'a cooked entry',
      () => mockLoad.mockResolvedValue({ ...entry, status: 'completed' } as never),
      'not_planned',
    ],
  ] as const)('refuses %s', async (_label, arrange, reason) => {
    arrange()

    const error = await loadAdjustContext('household-1', 'plan-1', 'entry-1', 'en').catch((e) => e)

    expect(error).toBeInstanceOf(AdjustEntryError)
    expect(error.reason).toBe(reason)
  })
})
