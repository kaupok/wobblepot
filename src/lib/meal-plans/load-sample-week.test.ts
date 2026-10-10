import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MEAL_IMAGE_PROMPT_VERSION } from '@/lib/meal-images/prompt'
import { stepsInputHash } from '@/lib/landing/steps-input-hash'
import { readSampleWeek } from './load-sample-week'
import type { SampleWeek } from './sample-weeks'

vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { meal: { findMany: vi.fn() } },
}))

import { prisma } from '@/lib/prisma'

const findMany = vi.mocked(prisma.meal.findMany)

const WEEK: SampleWeek = {
  slug: 'family-of-four',
  household: { adults: 2, children: 2 },
  ref: 'mp-family-of-four',
  meals: ['Omelette', 'Pasta', 'Missing', 'd', 'e', 'f', 'g'],
}

const steps = JSON.stringify({ steps: ['Whisk the eggs.'], pitfalls: [] })

function hashFor(name: string) {
  return stepsInputHash({
    mealName: name,
    servings: 4,
    timeMinutes: 10,
    components: [{ name: 'egg', quantityPerServing: 2, defaultUnit: 'piece' }],
    locale: 'en',
  })
}

function libraryMeal(name: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `meal-${name}`,
    name,
    description: `${name}, the description`,
    preparationNotes: null,
    timeMinutes: 10,
    kidFriendly: true,
    primaryProteinType: 'eggs',
    imageStatus: 'ready',
    imageUrl: 'https://example.public.blob.vercel-storage.com/meal.png',
    imageHue: 93,
    imagePromptVersion: MEAL_IMAGE_PROMPT_VERSION,
    components: [
      {
        ingredientId: 'ing-egg',
        quantityPerServing: 2,
        isVague: false,
        originalPhrase: null,
        ingredient: {
          id: 'ing-egg',
          name: 'egg',
          category: 'protein',
          defaultUnit: 'piece',
          gramsPerPiece: 50,
          measuredByVolume: false,
        },
      },
    ],
    preparationSteps: [{ locale: 'en', servings: 4, steps, inputHash: hashFor(name) }],
    ...overrides,
  }
}

describe('readSampleWeek', () => {
  beforeEach(() => {
    findMany.mockReset()
  })

  it('reads the named global meals with their English steps', async () => {
    findMany.mockResolvedValue([] as never)
    await readSampleWeek(WEEK)
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: { in: [...WEEK.meals] }, householdId: null, deletedAt: null },
        include: expect.objectContaining({
          preparationSteps: { where: { locale: 'en' } },
        }),
      }),
    )
  })

  it('returns the meals in the week’s order and leaves out a name with no meal', async () => {
    findMany.mockResolvedValue([libraryMeal('Pasta'), libraryMeal('Omelette')] as never)
    const meals = await readSampleWeek(WEEK)
    expect(meals.map((meal) => meal.name)).toEqual(['Omelette', 'Pasta'])
  })

  it('keeps the first row when a name is in the library twice', async () => {
    findMany.mockResolvedValue([
      libraryMeal('Omelette', { id: 'older' }),
      libraryMeal('Omelette', { id: 'newer' }),
    ] as never)
    const [first] = await readSampleWeek(WEEK)
    expect(first!.id).toBe('older')
  })

  it('carries the fresh steps, and none from a stale row', async () => {
    findMany.mockResolvedValue([
      libraryMeal('Omelette'),
      libraryMeal('Pasta', {
        preparationSteps: [{ locale: 'en', servings: 4, steps, inputHash: 'stale' }],
      }),
    ] as never)
    const meals = await readSampleWeek(WEEK)
    expect(meals[0]!.steps).toEqual(['Whisk the eggs.'])
    expect(meals[1]!.steps).toBeNull()
  })

  it('presents an image from an older prompt version as absent', async () => {
    findMany.mockResolvedValue([
      libraryMeal('Omelette', { imagePromptVersion: 'old' }),
      libraryMeal('Pasta'),
    ] as never)
    const meals = await readSampleWeek(WEEK)
    expect(meals[0]).toMatchObject({ imageStatus: 'none', imageUrl: null, imageHue: null })
    expect(meals[1]).toMatchObject({ imageStatus: 'ready', imageHue: 93 })
  })

  it('hands over the components the shopping list aggregates', async () => {
    findMany.mockResolvedValue([libraryMeal('Omelette')] as never)
    const [omelette] = await readSampleWeek(WEEK)
    expect(omelette!.components).toEqual([
      {
        ingredientId: 'ing-egg',
        quantityPerServing: 2,
        isVague: false,
        originalPhrase: null,
        ingredient: {
          id: 'ing-egg',
          name: 'egg',
          category: 'protein',
          defaultUnit: 'piece',
          gramsPerPiece: 50,
          measuredByVolume: false,
        },
      },
    ])
  })
})
