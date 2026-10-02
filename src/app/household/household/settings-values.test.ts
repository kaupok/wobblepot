import { describe, expect, it } from 'vitest'
import { sameValues } from './settings-values'

describe('sameValues', () => {
  it('matches equal scalars, nulls included', () => {
    expect(sameValues({ name: 'Home', diet: null }, { name: 'Home', diet: null })).toBe(true)
    expect(sameValues({ name: 'Home', diet: null }, { name: 'Home', diet: 'vegan' })).toBe(false)
  })

  it('compares lists by content, not order', () => {
    expect(sameValues({ a: ['gluten', 'dairy'] }, { a: ['dairy', 'gluten'] })).toBe(true)
  })

  it('tells lists of different content or length apart', () => {
    expect(sameValues({ a: ['gluten'] }, { a: ['dairy'] })).toBe(false)
    expect(sameValues({ a: ['gluten'] }, { a: ['gluten', 'dairy'] })).toBe(false)
    expect(sameValues({ a: [] as string[] }, { a: [] as string[] })).toBe(true)
  })

  it('does not reorder the lists it compares', () => {
    const list = ['soy', 'eggs']
    sameValues({ a: list }, { a: ['eggs', 'soy'] })
    expect(list).toEqual(['soy', 'eggs'])
  })
})
