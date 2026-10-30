import { describe, expect, it } from 'vitest'

import { asSold } from './as-sold-nutrition'

describe('asSold', () => {
  it('scales raw edible values by the edible part', () => {
    expect(asSold({ calories: 200, protein: 20, carbs: 0, fat: 12, fiber: 0 }, 0.75)).toEqual({
      calories: 150,
      protein: 15,
      carbs: 0,
      fat: 9,
      fiber: 0,
    })
  })

  it('rounds to one decimal', () => {
    expect(asSold({ calories: 221, protein: 16.5, carbs: 0.3, fat: 16.6, fiber: 0 }, 0.78)).toEqual(
      { calories: 172.4, protein: 12.9, carbs: 0.2, fat: 12.9, fiber: 0 },
    )
  })

  it.each([0, -0.1, 1.2, Number.NaN])('rejects an edible part of %s', (ediblePart) => {
    expect(() =>
      asSold({ calories: 100, protein: 20, carbs: 0, fat: 2, fiber: 0 }, ediblePart),
    ).toThrow(RangeError)
  })
})
