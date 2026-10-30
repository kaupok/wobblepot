import { describe, expect, it } from 'vitest'

import {
  catalogueFormName,
  guardFormMatch,
  hasForm,
  isOtherCutFillet,
  removedForms,
} from './form-modifier-guard'
import type { FuzzyIngredientMatch } from './fuzzy-ingredient-match'

function row(id: string, name: string, similarity: number): FuzzyIngredientMatch {
  return {
    id,
    name,
    matchedName: name,
    similarity,
    source: 'global',
    category: 'vegetable',
    subcategory: null,
    defaultUnit: 'piece',
    gramsPerPiece: null,
    measuredByVolume: false,
    calories: 20,
    protein: 1,
    carbs: 4,
    fat: 0,
    proteinType: null,
  }
}

const tomato = row('ing-tomato', 'tomato', 1)

describe('removedForms', () => {
  it('names the form normalization removed, with canned read as tinned', () => {
    expect(removedForms('canned chopped tomatoes', 'tomato')).toEqual(['tinned'])
    expect(removedForms('frozen peas', 'pea')).toEqual(['frozen'])
    expect(removedForms('dried oregano', 'oregano')).toEqual(['dried'])
  })

  it('names no form when the name has none, or normalization kept it', () => {
    expect(removedForms('chopped tomatoes', 'tomato')).toEqual([])
    expect(removedForms('tinned tuna', 'tinned tuna')).toEqual([])
  })
})

describe('hasForm and catalogueFormName', () => {
  it('treats canned and tinned as one form', () => {
    expect(hasForm('canned tomatoes', ['tinned'])).toBe(true)
    expect(hasForm('tomato', ['tinned'])).toBe(false)
  })

  it('writes canned as tinned', () => {
    expect(catalogueFormName('canned crushed tomatoes')).toBe('tinned crushed tomatoes')
  })
})

describe('guardFormMatch', () => {
  it('uses a sure form row of the same food from the direct side', () => {
    const direct = [row('ing-tinned', 'tinned chopped tomatoes', 0.76)]

    expect(guardFormMatch(['tinned'], 'tomato', tomato, [direct])).toEqual({
      action: 'use',
      matches: direct,
    })
  })

  it('flags the winner when the form row is not sure, with the form row first', () => {
    const direct = [row('ing-crushed', 'crushed tomatoes', 0.7)]
    const formName = [row('ing-tinned', 'tinned chopped tomatoes', 0.57)]

    const result = guardFormMatch(['tinned'], 'tomato', tomato, [direct, formName])

    expect(result).toEqual({
      action: 'flag',
      alternatives: [formName[0], direct[0]],
    })
  })

  it('keeps the winner when no row has the form', () => {
    const direct = [row('ing-cumin', 'cumin', 0.5)]

    expect(guardFormMatch(['dried'], 'cumin', row('ing-cumin', 'cumin', 1), [direct])).toEqual({
      action: 'keep',
    })
  })

  it('keeps the winner when the form row is another food: "dried dill" for "dried cumin"', () => {
    const direct = [row('ing-dried-dill', 'dried dill', 0.62)]

    expect(guardFormMatch(['dried'], 'cumin', row('ing-cumin', 'cumin', 1), [direct])).toEqual({
      action: 'keep',
    })
  })

  it('keeps a winner that already has the form', () => {
    const winner = row('ing-tinned', 'tinned chopped tomatoes', 1)

    expect(guardFormMatch(['tinned'], 'tomato', winner, [[tomato]])).toEqual({ action: 'keep' })
  })
})

// HON-1480: the catalogue writes a boneless cut "<cut> fillet"
describe('the boneless form', () => {
  const thigh = row('ing-thigh', 'chicken thigh', 1)

  it('names boneless and deboned as the boneless form, and fillet carries it', () => {
    expect(removedForms('boneless skinless chicken thighs', 'chicken thigh')).toEqual(['boneless'])
    expect(removedForms('deboned chicken thighs', 'chicken thigh')).toEqual(['boneless'])
    expect(removedForms('chicken thigh fillets', 'chicken thigh fillet')).toEqual([])
    expect(hasForm('chicken thigh fillet', ['boneless'])).toBe(true)
    expect(hasForm('chicken thigh', ['boneless'])).toBe(false)
  })

  it('uses the fillet row of the same cut', () => {
    const fillet = [row('ing-thigh-fillet', 'chicken thigh fillet', 1)]

    expect(guardFormMatch(['boneless'], 'chicken thigh', thigh, [fillet])).toEqual({
      action: 'use',
      matches: fillet,
    })
  })

  it('keeps the bare row when the only fillet row is another cut', () => {
    const others = [
      row('ing-turkey-thigh-fillet', 'turkey thigh fillet', 0.8),
      row('ing-pork-fillet', 'pork fillet', 0.7),
    ]

    expect(guardFormMatch(['boneless'], 'chicken thigh', thigh, [others])).toEqual({
      action: 'keep',
    })
  })
})

describe('isOtherCutFillet', () => {
  it('flags a fillet row that lacks the cut the recipe names', () => {
    expect(isOtherCutFillet('chicken leg fillet', 'chicken fillet')).toBe(true)
    expect(isOtherCutFillet('beef chuck fillet', 'beef fillet')).toBe(true)
  })

  it('keeps a fillet row when the extra word names no cut, or the row is the cut', () => {
    expect(isOtherCutFillet('wild salmon fillet', 'salmon fillet')).toBe(false)
    expect(isOtherCutFillet('salmon fillet portion', 'salmon fillet')).toBe(false)
    expect(isOtherCutFillet('chicken thigh', 'chicken thigh fillet')).toBe(false)
    expect(isOtherCutFillet('chicken leg', 'chicken leg')).toBe(false)
  })
})
