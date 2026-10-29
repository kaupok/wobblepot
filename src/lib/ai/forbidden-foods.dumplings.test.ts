// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { findViolations, rulesForHousehold } from './forbidden-foods'

// HON-1262: a filled dumpling's dish word hides its filling, so the guard has
// to read "pelmeni" as meat before the matcher maps it to the pork row.

const meal = (ingredient: string) => ({ name: 'Dish', ingredients: [{ name: ingredient }] })

function violationsFor(
  household: { allergens?: string[]; dietaryType?: string },
  ingredient: string,
) {
  const rules = rulesForHousehold({
    allergens: household.allergens ?? [],
    dietaryType: household.dietaryType ?? null,
  })
  return findViolations(meal(ingredient), rules)
}

describe('filled dumplings', () => {
  it('reads a bare pelmeni as meat for a vegetarian', () => {
    expect(violationsFor({ dietaryType: 'vegetarian' }, 'pelmeni')).toEqual([
      expect.objectContaining({
        constraint: 'vegetarian',
        keyword: 'pelmeni',
        field: 'ingredient',
      }),
    ])
  })

  it.each(['vegetable gyoza', 'gyoza wrappers', 'kartulipelmeenid', 'köögiviljagyoza'])(
    'lets %s through for a vegetarian',
    (ingredient) => {
      expect(violationsFor({ dietaryType: 'vegetarian' }, ingredient)).toEqual([])
    },
  )

  // The potato-dumpling excuse is a false friend, not a "kartuli" prefix, so the
  // pork in a potato sausage still counts.
  it('still reads kartulivorst as meat for a vegetarian', () => {
    expect(violationsFor({ dietaryType: 'vegetarian' }, 'kartulivorst')).toEqual([
      expect.objectContaining({ constraint: 'vegetarian', keyword: 'vorst' }),
    ])
  })

  it.each([
    [['gluten'], 'gyoza', 'gyoza'],
    [['shellfish'], 'har gow', 'har gow'],
  ])('reads %s in %s', (allergens, ingredient, keyword) => {
    expect(violationsFor({ allergens }, ingredient)).toEqual([
      expect.objectContaining({ constraint: allergens[0], keyword, field: 'ingredient' }),
    ])
  })

  it('lets gluten-free gyoza wrappers through for a gluten allergy', () => {
    expect(violationsFor({ allergens: ['gluten'] }, 'gluten-free gyoza wrappers')).toEqual([])
  })
})
