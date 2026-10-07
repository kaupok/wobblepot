import { describe, expect, it } from 'vitest'
import { stepsInputHash } from './steps-input-hash'

const input = {
  mealName: 'Avocado toast',
  servings: 4,
  timeMinutes: 10,
  components: [
    { name: 'Egg', quantityPerServing: 2, defaultUnit: 'piece' },
    { name: 'Bread', quantityPerServing: 80, defaultUnit: 'g' },
  ],
  locale: 'en',
}

describe('stepsInputHash', () => {
  it('is the same for the same components in any order', () => {
    const reversed = { ...input, components: [...input.components].reverse() }
    expect(stepsInputHash(reversed)).toBe(stepsInputHash(input))
  })

  it('changes with any prompt input', () => {
    const base = stepsInputHash(input)
    expect(stepsInputHash({ ...input, mealName: 'Avocado toast with egg' })).not.toBe(base)
    expect(stepsInputHash({ ...input, servings: 2 })).not.toBe(base)
    expect(stepsInputHash({ ...input, timeMinutes: 15 })).not.toBe(base)
    expect(stepsInputHash({ ...input, locale: 'et' })).not.toBe(base)
    expect(
      stepsInputHash({
        ...input,
        components: [input.components[0]!, { ...input.components[1]!, quantityPerServing: 60 }],
      }),
    ).not.toBe(base)
  })

  it('keeps the hash of a meal with no liquid, so its stored row stays fresh (HON-1070)', () => {
    // The value before `measuredByVolume` reached the steps prompt. A change
    // here stales every library row on the next deploy.
    expect(stepsInputHash(input)).toBe(
      '554b43e9507e028e7e2b34ba7cc8edb79069db7efdd8289664f3f02b4b1c817b',
    )
    expect(
      stepsInputHash({
        ...input,
        components: input.components.map((c) => ({ ...c, measuredByVolume: false })),
      }),
    ).toBe(stepsInputHash(input))
  })

  it('changes when a gram ingredient turns to ml, as the prompt line does (HON-1070)', () => {
    expect(
      stepsInputHash({
        ...input,
        components: [input.components[0]!, { ...input.components[1]!, measuredByVolume: true }],
      }),
    ).not.toBe(stepsInputHash(input))
  })
})
