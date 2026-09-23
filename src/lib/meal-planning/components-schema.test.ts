import { describe, it, expect } from 'vitest'
import {
  duplicateComponentIds,
  MAX_MEAL_COMPONENTS,
  mealComponentsSchema,
} from './components-schema'

const component = (ingredientId: string, totalQuantity = 100) => ({ ingredientId, totalQuantity })

describe('mealComponentsSchema', () => {
  it('accepts distinct ingredients', () => {
    const result = mealComponentsSchema.safeParse([component('a'), component('b')])

    expect(result.success).toBe(true)
  })

  it('zeroes the quantity of a vague component', () => {
    const result = mealComponentsSchema.parse([
      { ingredientId: 'a', totalQuantity: 5, isVague: true },
    ])

    expect(result[0]?.totalQuantity).toBe(0)
  })

  it('reports each repeated ingredient once', () => {
    const result = mealComponentsSchema.safeParse([
      component('a'),
      component('b'),
      component('a'),
      component('b'),
      component('a'),
      component('c'),
    ])

    expect(result.success).toBe(false)
    expect(duplicateComponentIds(result.error!)).toEqual(['a', 'b'])
  })

  it('rejects an empty list', () => {
    expect(mealComponentsSchema.safeParse([]).success).toBe(false)
  })

  it(`accepts ${MAX_MEAL_COMPONENTS} components and rejects one more`, () => {
    const list = (n: number) => Array.from({ length: n }, (_, i) => component(`ing-${i}`))

    expect(mealComponentsSchema.safeParse(list(MAX_MEAL_COMPONENTS)).success).toBe(true)

    const over = mealComponentsSchema.safeParse(list(MAX_MEAL_COMPONENTS + 1))
    expect(over.success).toBe(false)
    expect(duplicateComponentIds(over.error!)).toBeNull()
  })
})
