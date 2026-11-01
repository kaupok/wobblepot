import { describe, expect, it } from 'vitest'

import { defaultCookOutcome } from './cook-outcome'

type Input = Parameters<typeof defaultCookOutcome>[0]

function outcome(overrides: Partial<Input>) {
  return defaultCookOutcome({
    pantryQuantity: null,
    isStaple: false,
    category: 'vegetable',
    subcategory: null,
    defaultUnit: 'g',
    amountUsed: 100,
    ...overrides,
  })
}

describe('defaultCookOutcome', () => {
  it('does not touch a staple, such as salt', () => {
    expect(outcome({ isStaple: true, category: 'spice', subcategory: 'salt' })).toBeNull()
  })

  it('subtracts from a known quantity, such as 500 g of quinoa', () => {
    expect(outcome({ pantryQuantity: 500, category: 'carb', subcategory: 'grain' })).toBe(
      'subtract',
    )
  })

  it('subtracts from a known fresh quantity too', () => {
    expect(outcome({ pantryQuantity: 2, category: 'fruit', defaultUnit: 'piece' })).toBe('subtract')
  })

  describe('a "have some" row', () => {
    it.each([
      ['smoked paprika', 'spice', 'chili'],
      ['a dried herb', 'spice', 'dried herb'],
      ['cumin', 'spice', null],
      ['tahini', 'condiment', 'spread'],
      ['olive oil', 'fat', 'oil'],
      ['chickpeas', 'legume', 'bean'],
      ['quinoa', 'carb', 'grain'],
      ['rice', 'carb', 'rice'],
      ['flour', 'carb', 'flour'],
      ['oats', 'carb', 'cereal'],
      ['a baking mix', 'carb', 'baking mix'],
    ] as const)('keeps %s, a cupboard item', (_name, category, subcategory) => {
      expect(outcome({ category, subcategory })).toBe('someLeft')
    })

    it.each([
      ['fresh dill', 'spice', 'herb'],
      ['frozen peas', 'legume', 'legume-vegetable'],
      ['bread', 'carb', 'bread'],
      ['a potato', 'carb', 'root'],
      ['a carb with no subcategory', 'carb', null],
      ['pumpkin', 'vegetable', null],
      ['chicken', 'protein', null],
      ['yoghurt', 'dairy', null],
    ] as const)('uses up %s, a fresh item', (_name, category, subcategory) => {
      expect(outcome({ category, subcategory })).toBe('usedUp')
    })

    it('keeps half a lemon', () => {
      expect(outcome({ category: 'fruit', defaultUnit: 'piece', amountUsed: 0.5 })).toBe('someLeft')
    })

    it('uses up 2 lemons', () => {
      expect(outcome({ category: 'fruit', defaultUnit: 'piece', amountUsed: 2 })).toBe('usedUp')
    })

    it('uses up a whole piece', () => {
      expect(outcome({ category: 'fruit', defaultUnit: 'piece', amountUsed: 1 })).toBe('usedUp')
    })

    it('uses up 40 g of a fresh item: no amount threshold', () => {
      expect(outcome({ category: 'spice', subcategory: 'herb', amountUsed: 40 })).toBe('usedUp')
    })
  })
})
