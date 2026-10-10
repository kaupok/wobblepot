import { describe, expect, it, vi } from 'vitest'
import { MIXED_VAGUE_PHRASE } from '@/lib/vague-quantities'
import { aggregateComponents, type AggregationComponent } from './shopping-list'

// shopping-list.ts imports Prisma for its two database functions; this pure
// one never touches it.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

function component(
  id: string,
  quantityPerServing: number,
  vague: string | null = null,
): AggregationComponent {
  return {
    ingredientId: id,
    quantityPerServing,
    isVague: vague !== null,
    originalPhrase: vague,
    ingredient: {
      id,
      name: id,
      category: 'vegetable',
      defaultUnit: 'g',
      gramsPerPiece: null,
      measuredByVolume: false,
      translations: [{ locale: 'et', name: `${id} (et)` }],
    },
  }
}

const MONDAY = new Date('2026-10-12T00:00:00Z')
const TUESDAY = new Date('2026-10-13T00:00:00Z')

describe('aggregateComponents', () => {
  it('sums quantity × servings per ingredient and counts the meals', () => {
    const needed = aggregateComponents(
      [
        { date: TUESDAY, servings: 2, components: [component('onion', 50)] },
        { date: MONDAY, servings: 3, components: [component('onion', 40), component('leek', 10)] },
      ],
      'en',
    )
    expect(needed.get('onion')).toMatchObject({
      quantity: 220,
      mealCount: 2,
      earliestNeededDate: MONDAY,
      isVague: false,
    })
    expect(needed.get('leek')).toMatchObject({ quantity: 30, mealCount: 1 })
  })

  it('marks an item vague, and two different phrases become "some"', () => {
    const same = aggregateComponents(
      [
        { date: MONDAY, servings: 1, components: [component('salt', 1, 'a pinch')] },
        { date: TUESDAY, servings: 1, components: [component('salt', 1, 'pinch')] },
      ],
      'en',
    )
    expect(same.get('salt')).toMatchObject({ isVague: true, originalPhrase: 'a pinch' })

    const mixed = aggregateComponents(
      [
        { date: MONDAY, servings: 1, components: [component('salt', 1, 'to taste')] },
        { date: TUESDAY, servings: 1, components: [component('salt', 1, 'a pinch')] },
      ],
      'en',
    )
    expect(mixed.get('salt')!.originalPhrase).toBe(MIXED_VAGUE_PHRASE)
  })

  it('names the ingredient in the locale', () => {
    const needed = aggregateComponents(
      [{ date: MONDAY, servings: 1, components: [component('onion', 50)] }],
      'et',
    )
    expect(needed.get('onion')!.ingredient.name).toBe('onion (et)')
  })

  it('returns an empty map for no entries', () => {
    expect(aggregateComponents([], 'en').size).toBe(0)
  })
})
