import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MEAL_IMAGE_PROMPT_VERSION } from '@/lib/meal-images/prompt'
import { loadDemoDay, pickDemoMeals } from './load-demo-day'
import { stepsInputHash } from './steps-input-hash'

vi.mock('@/lib/prisma', () => ({
  prisma: { meal: { findMany: vi.fn() } },
}))

import { prisma } from '@/lib/prisma'

const findMany = vi.mocked(prisma.meal.findMany)

const steps = JSON.stringify({ steps: ['Toast the bread'], pitfalls: [] })

/** The hash the loader expects for a meal as `libraryMeal` builds it. */
function hashFor(name: string, locale: 'en' | 'et') {
  return stepsInputHash({
    mealName: name,
    servings: 4,
    timeMinutes: 10,
    components: [
      { name: locale === 'et' ? 'Muna' : 'Egg', quantityPerServing: 2, defaultUnit: 'piece' },
    ],
    locale,
  })
}

function libraryMeal(overrides: Record<string, unknown> = {}) {
  const name = typeof overrides.name === 'string' ? overrides.name : 'Avocado toast'
  return {
    id: 'meal-1',
    name: 'Avocado toast',
    description: 'Toast with avocado',
    preparationNotes: null,
    timeMinutes: 10,
    kidFriendly: true,
    primaryProteinType: 'eggs',
    suitableFor: ['breakfast', 'lunch'],
    servings: 4,
    householdId: null,
    updatedAt: new Date('2026-10-01T10:00:00Z'),
    imageStatus: 'ready',
    imageUrl: 'https://example.public.blob.vercel-storage.com/meal.png',
    imageHue: 93,
    imagePromptVersion: MEAL_IMAGE_PROMPT_VERSION,
    translations: [
      { locale: 'et', name: 'Avokaadovõileib', description: null, preparationNotes: null },
    ],
    components: [
      {
        ingredientId: 'ing-1',
        quantityPerServing: 2,
        isVague: false,
        originalPhrase: null,
        ingredient: {
          id: 'ing-1',
          name: 'Egg',
          category: 'protein',
          defaultUnit: 'piece',
          gramsPerPiece: 50,
          calories: 155,
          protein: 13,
          carbs: 1,
          fat: 11,
          translations: [{ locale: 'et', name: 'Muna' }],
        },
      },
    ],
    preparationSteps: [{ locale: 'en', servings: 4, steps, inputHash: hashFor(name, 'en') }],
    ...overrides,
  }
}

const pool = [
  libraryMeal(),
  libraryMeal({ id: 'meal-2', name: 'Bibimbap', suitableFor: ['lunch', 'dinner'] }),
  libraryMeal({ id: 'meal-3', name: 'Salmon', suitableFor: ['dinner'] }),
]

describe('pickDemoMeals', () => {
  const candidates = [
    { id: 'b', suitableFor: ['breakfast', 'lunch'] as const },
    { id: 'a', suitableFor: ['breakfast'] as const },
    { id: 'c', suitableFor: ['lunch', 'dinner'] as const },
    { id: 'd', suitableFor: ['dinner'] as const },
  ].map((m) => ({ ...m, suitableFor: [...m.suitableFor] }))

  it('fills every slot with a different meal, the same way for the same date', () => {
    const first = pickDemoMeals(candidates, '2026-10-02')
    const again = pickDemoMeals(candidates, '2026-10-02')
    expect(first).not.toBeNull()
    expect([...first!.values()].map((m) => m.id)).toEqual([...again!.values()].map((m) => m.id))
    expect(new Set([...first!.values()].map((m) => m.id)).size).toBe(3)
    expect(first!.get('breakfast')!.suitableFor).toContain('breakfast')
    expect(first!.get('dinner')!.suitableFor).toContain('dinner')
  })

  it('does not depend on the order of the pool', () => {
    const forward = pickDemoMeals(candidates, '2026-10-02')!
    const reversed = pickDemoMeals([...candidates].reverse(), '2026-10-02')!
    expect([...forward.values()].map((m) => m.id)).toEqual([...reversed.values()].map((m) => m.id))
  })

  it('changes with the date', () => {
    const picks = new Set(
      ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'].map(
        (date) => [...pickDemoMeals(candidates, date)!.values()].map((m) => m.id).join(','),
      ),
    )
    expect(picks.size).toBeGreaterThan(1)
  })

  it('is null when a slot has no candidate', () => {
    expect(pickDemoMeals([{ id: 'a', suitableFor: ['breakfast'] }], '2026-10-02')).toBeNull()
  })
})

describe('loadDemoDay', () => {
  beforeEach(() => {
    findMany.mockReset()
  })

  it('maps the picked meals to the cook view shape with their steps', async () => {
    findMany.mockResolvedValue(pool as never)

    const day = await loadDemoDay({ locale: 'en', date: '2026-10-02' })

    expect(day).not.toBeNull()
    expect(day!.date).toBe('2026-10-02')
    expect(day!.meals.map((m) => m.mealType)).toEqual(['breakfast', 'lunch', 'dinner'])
    const breakfast = day!.meals[0]!
    expect(breakfast.meal.name).toBe('Avocado toast')
    expect(breakfast.meal.isCustom).toBe(false)
    expect(breakfast.meal.imageHue).toBe(93)
    expect(breakfast.meal.components[0]!.ingredient.name).toBe('Egg')
    expect(breakfast.meal.nutrition.calories).toBeGreaterThan(0)
    expect(breakfast.steps).toEqual({ steps: ['Toast the bread'], pitfalls: [] })
    expect(breakfast.servings).toBe(4)
    // Only meals the page can show are asked for.
    expect(findMany.mock.calls[0]![0]!.where).toMatchObject({
      householdId: null,
      deletedAt: null,
      imageStatus: 'ready',
      preparationSteps: { some: { locale: { in: ['en'] } } },
    })
  })

  it('reads the visitor locale with English as the fallback', async () => {
    findMany.mockResolvedValue(
      pool.map((meal, index) =>
        index === 0
          ? {
              ...meal,
              preparationSteps: [
                ...meal.preparationSteps,
                {
                  locale: 'et',
                  servings: 4,
                  steps: JSON.stringify({ steps: ['Rösti leib'], pitfalls: [] }),
                  inputHash: hashFor('Avokaadovõileib', 'et'),
                },
              ],
            }
          : meal,
      ) as never,
    )

    const day = await loadDemoDay({ locale: 'et', date: '2026-10-02' })

    expect(findMany.mock.calls[0]![0]!.where).toMatchObject({
      preparationSteps: { some: { locale: { in: ['et', 'en'] } } },
    })
    const [breakfast, lunch] = day!.meals
    expect(breakfast!.meal.name).toBe('Avokaadovõileib')
    expect(breakfast!.meal.components[0]!.ingredient.name).toBe('Muna')
    expect(breakfast!.steps.steps).toEqual(['Rösti leib'])
    // No Estonian row: the English steps.
    expect(lunch!.steps.steps).toEqual(['Toast the bread'])
  })

  it('leaves out a meal whose steps were written from other inputs, and is null when a slot empties', async () => {
    // The dinner's ingredient was renamed since its row was written.
    findMany.mockResolvedValue(
      pool.map((meal) =>
        meal.id === 'meal-3'
          ? {
              ...meal,
              components: [
                {
                  ...meal.components[0],
                  ingredient: { ...meal.components[0]!.ingredient, name: 'Salmon fillet' },
                },
              ],
            }
          : meal,
      ) as never,
    )

    expect(await loadDemoDay({ locale: 'en', date: '2026-10-02' })).toBeNull()
  })

  it('leaves out a meal whose illustration is from an old prompt', async () => {
    findMany.mockResolvedValue(
      pool.map((meal) =>
        meal.id === 'meal-3' ? { ...meal, imagePromptVersion: 'v0' } : meal,
      ) as never,
    )

    expect(await loadDemoDay({ locale: 'en', date: '2026-10-02' })).toBeNull()
  })
})
