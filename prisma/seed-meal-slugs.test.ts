import { describe, expect, it } from 'vitest'
import { slugify } from '../scripts/spike-meal-images'
import { newMeals } from './seed-expansion'
import { checkMealSlugCollisions, mealSlug } from './seed-meal-slugs'

describe('mealSlug', () => {
  it.each([
    "Shepherd's Pie",
    'Shepherd’s Pie',
    '  Mac & Cheese!  ',
    'Crème Brûlée',
    'BLT Sandwich',
  ])('matches the image batch slugify for %j', (name) => {
    expect(mealSlug(name)).toBe(slugify(name))
  })
})

describe('checkMealSlugCollisions', () => {
  it('rejects two names that share a slug and names both', () => {
    expect(
      checkMealSlugCollisions([{ name: "Shepherd's Pie" }, { name: 'Shepherd’s Pie' }]),
    ).toEqual(["Meal names share the slug 'shepherd-s-pie': 'Shepherd's Pie', 'Shepherd’s Pie'"])
  })

  it('accepts names with distinct slugs', () => {
    expect(
      checkMealSlugCollisions([{ name: "Shepherd's Pie" }, { name: "Lamb Shepherd's Pie" }]),
    ).toEqual([])
  })

  it('leaves an exact duplicate name to the duplicate-meal check', () => {
    expect(checkMealSlugCollisions([{ name: 'Beef Stew' }, { name: 'Beef Stew' }])).toEqual([])
  })

  it('finds no collision between the expansion meals and the beef pie', () => {
    expect(checkMealSlugCollisions([...newMeals, { name: "Shepherd's Pie" }])).toEqual([])
  })
})
