import { describe, expect, it } from 'vitest'

import { COOKING_MODIFIERS } from '@/lib/normalize-ingredient'

import {
  catalogueFormName,
  compoundFormName,
  foodNameOf,
  FORM_WORDS,
  guardFormMatch,
  hasForm,
  isOtherCutFillet,
  missingForms,
} from './form-modifier-guard'
import type { FuzzyIngredientMatch } from './fuzzy-ingredient-match'

function row(
  id: string,
  name: string,
  similarity: number,
  more: Partial<FuzzyIngredientMatch> = {},
): FuzzyIngredientMatch {
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
    ...more,
  }
}

const tomato = row('ing-tomato', 'tomato', 1)

describe('missingForms', () => {
  it('names the form the row lacks, with canned read as tinned', () => {
    expect(missingForms('canned chopped tomatoes', tomato)).toEqual(['tinned'])
    expect(missingForms('frozen peas', row('ing-pea', 'pea', 1))).toEqual(['frozen'])
    expect(missingForms('smoked garlic', row('ing-garlic', 'garlic', 1))).toEqual(['smoked'])
  })

  // HON-1554: Estonian form words, checked against both of the row's names
  it('reads an Estonian form word, and the row may carry it in either language', () => {
    const bellPepper = row('ing-bell-pepper', 'bell pepper', 1, { matchedName: 'paprika' })
    const smokedPaprika = row('ing-smoked-paprika', 'smoked paprika', 1, {
      matchedName: 'suitsupaprikapulber',
    })
    const gherkins = row('ing-gherkins', 'pickled gherkins', 1, {
      matchedName: 'marineeritud kurgid',
    })

    expect(missingForms('suitsutatud paprika', bellPepper)).toEqual(['smoked'])
    expect(missingForms('suitsutatud paprika', smokedPaprika)).toEqual([])
    expect(missingForms('marineeritud kurk', gherkins)).toEqual([])
    expect(missingForms('külmutatud lillkapsas', row('ing-c', 'cauliflower', 1))).toEqual([
      'frozen',
    ])
    expect(missingForms('kuivatatud sibul', row('ing-onion', 'onion', 1))).toEqual(['dried'])
  })

  it('names no form when the name has none, or the row is already that form', () => {
    expect(missingForms('chopped tomatoes', tomato)).toEqual([])
    expect(missingForms('tinned tuna', row('ing-tuna', 'tinned tuna', 1))).toEqual([])
    expect(missingForms('paprika', row('ing-bell-pepper', 'bell pepper', 1))).toEqual([])
  })
})

describe('compoundFormName', () => {
  it('joins an Estonian form stem to the food', () => {
    expect(compoundFormName('suitsutatud paprika')).toBe('suitsupaprika')
  })

  it('has no compound for a name without a compound form word', () => {
    expect(compoundFormName('kuivatatud sibul')).toBeUndefined()
    expect(compoundFormName('smoked paprika')).toBeUndefined()
    expect(compoundFormName('suitsutatud')).toBeUndefined()
    expect(compoundFormName('marineeritud kurk')).toBeUndefined()
  })
})

describe('hasForm and catalogueFormName', () => {
  it('treats canned and tinned as one form', () => {
    expect(hasForm('canned tomatoes', ['tinned'])).toBe(true)
    expect(hasForm('tomato', ['tinned'])).toBe(false)
  })

  it('finds an Estonian form stem inside a compound name', () => {
    expect(hasForm('suitsupaprikapulber', ['smoked'])).toBe(true)
    expect(hasForm('hapukapsas', ['pickled'])).toBe(true)
    expect(hasForm('külmutatud brokoli', ['frozen'])).toBe(true)
    expect(hasForm('paprika', ['smoked'])).toBe(false)
  })

  it('writes canned as tinned', () => {
    expect(catalogueFormName('canned crushed tomatoes')).toBe('tinned crushed tomatoes')
  })
})

describe('foodNameOf', () => {
  it.each([
    ['chickpeas, drained', 'chickpeas'],
    ['chickpeas, dried', 'dried chickpeas'],
    ['kidney beans, dried and soaked overnight', 'dried kidney beans'],
    ['dried chickpeas, soaked', 'dried chickpeas'],
    ['peas, frozen', 'frozen peas'],
    ['chicken thighs, boneless', 'boneless chicken thighs'],
    ['salmon, fillet', 'salmon, fillet'],
    ['sugar, brown', 'sugar, brown'],
    ['tomatoes, cherry', 'tomatoes, cherry'],
    ['peas, fresh or frozen', 'peas'],
    ['spinach, thawed if frozen', 'spinach'],
    ['chickpeas, canned and dried', 'chickpeas'],
    ['red onion', 'red onion'],
  ])('reads "%s" as "%s"', (name, food) => {
    expect(foodNameOf(name)).toBe(food)
  })
})

describe('guardFormMatch', () => {
  it('uses a sure form row of the same food from the direct side', () => {
    const direct = [row('ing-tinned', 'tinned chopped tomatoes', 0.76)]

    expect(guardFormMatch(['tinned'], 'tomato', [tomato], [direct])).toEqual({
      action: 'use',
      matches: direct,
    })
  })

  it('flags the winner when the form row is not sure, with the form row first', () => {
    const direct = [row('ing-crushed', 'crushed tomatoes', 0.7)]
    const formName = [row('ing-tinned', 'tinned chopped tomatoes', 0.57)]

    const result = guardFormMatch(['tinned'], 'tomato', [tomato], [direct, formName])

    expect(result).toEqual({
      action: 'flag',
      alternatives: [formName[0], tomato],
    })
  })

  // HON-1554: a form name never saves sure as the bare row
  it('flags the winner when no row has the form, with the winner first', () => {
    const garlic = row('ing-garlic', 'garlic', 1)
    const direct = [row('ing-garlic', 'garlic', 0.5)]

    expect(guardFormMatch(['smoked'], 'garlic', [garlic], [direct])).toEqual({
      action: 'flag',
      alternatives: [garlic],
    })
  })

  it('flags the winner when the form row is another food: "dried dill" for "dried mint"', () => {
    const mint = row('ing-mint', 'mint', 1)
    const direct = [row('ing-dried-dill', 'dried dill', 0.62)]

    expect(guardFormMatch(['dried'], 'mint', [mint], [direct])).toEqual({
      action: 'flag',
      alternatives: [mint],
    })
  })

  it('uses an Estonian compound form row: "suitsupaprikapulber" for "suitsutatud paprika"', () => {
    const bellPepper = row('ing-bell-pepper', 'bell pepper', 1, { matchedName: 'paprika' })
    const compound = [
      row('ing-smoked-paprika', 'smoked paprika', 0.62, { matchedName: 'suitsupaprikapulber' }),
    ]

    expect(guardFormMatch(['smoked'], 'suitsutatud paprika', [bellPepper], [[], compound])).toEqual(
      { action: 'use', matches: compound },
    )
  })

  it('keeps a bare spice, legume or carb row that may already be the form', () => {
    const cumin = row('ing-cumin', 'cumin', 1, { category: 'spice' })
    const chickpeas = row('ing-chickpeas', 'chickpeas', 1, { category: 'legume' })

    expect(guardFormMatch(['ground'], 'cumin', [cumin], [[cumin]])).toEqual({ action: 'keep' })
    expect(guardFormMatch(['tinned'], 'chickpea', [chickpeas], [[]])).toEqual({ action: 'keep' })
    expect(guardFormMatch(['smoked'], 'cumin', [cumin], [[cumin]])).toMatchObject({
      action: 'flag',
    })
  })

  it('uses a form row over a bare legume row: "dried chickpeas"', () => {
    const chickpeas = row('ing-chickpeas', 'chickpeas', 1, { category: 'legume' })
    const direct = [row('ing-dried-chickpeas', 'dried chickpeas', 1, { category: 'legume' })]

    expect(guardFormMatch(['dried'], 'chickpea', [chickpeas], [direct])).toEqual({
      action: 'use',
      matches: direct,
    })
  })

  it('keeps the winner when no form is missing', () => {
    expect(guardFormMatch([], 'tomato', [tomato], [[tomato]])).toEqual({ action: 'keep' })
  })
})

// HON-1480: the catalogue writes a boneless cut "<cut> fillet"
describe('the boneless form', () => {
  const thigh = row('ing-thigh', 'chicken thigh', 1)

  it('names boneless and deboned as the boneless form, and fillet carries it', () => {
    expect(missingForms('boneless skinless chicken thighs', thigh)).toEqual(['boneless'])
    expect(missingForms('deboned chicken thighs', thigh)).toEqual(['boneless'])
    expect(missingForms('chicken thigh fillets', row('ing-f', 'chicken thigh fillet', 1))).toEqual(
      [],
    )
    expect(hasForm('chicken thigh fillet', ['boneless'])).toBe(true)
    expect(hasForm('chicken thigh', ['boneless'])).toBe(false)
  })

  // HON-1571
  it('names kondita and filee as the boneless form', () => {
    expect(missingForms('kondita kanakintsud', thigh)).toEqual(['boneless'])
    expect(missingForms('kanakintsu filee', thigh)).toEqual(['boneless'])
  })

  it('keeps "kanakintsud, filee" as written, as it does "salmon, fillet"', () => {
    expect(foodNameOf('kanakintsud, filee')).toBe('kanakintsud, filee')
  })

  it('uses the fillet row of the same cut', () => {
    const fillet = [row('ing-thigh-fillet', 'chicken thigh fillet', 1)]

    expect(guardFormMatch(['boneless'], 'chicken thigh', [thigh], [fillet])).toEqual({
      action: 'use',
      matches: fillet,
    })
  })

  // HON-1579: Estonian joins the fillet to the cut
  it('reads an Estonian fillet compound as boneless, but not mince or a bare meat', () => {
    expect(hasForm('kanakintsuliha', ['boneless'])).toBe(true)
    expect(hasForm('lõhefilee', ['boneless'])).toBe(true)
    expect(hasForm('kanakints', ['boneless'])).toBe(false)
    expect(hasForm('kanahakkliha', ['boneless'])).toBe(false)
    expect(hasForm('küülikuliha', ['boneless'])).toBe(false)
  })

  it('uses the Estonian fillet row of a plural cut', () => {
    const fillet = [row('ing-thigh-fillet', 'kanakintsuliha', 1)]

    expect(guardFormMatch(['boneless'], 'kanakintsud', [thigh], [fillet])).toEqual({
      action: 'use',
      matches: fillet,
    })
  })

  it('keeps the bare row when the only fillet row is another cut', () => {
    const others = [
      row('ing-turkey-thigh-fillet', 'turkey thigh fillet', 0.8),
      row('ing-pork-fillet', 'pork fillet', 0.7),
    ]

    expect(guardFormMatch(['boneless'], 'chicken thigh', [thigh], [others])).toEqual({
      action: 'keep',
    })
  })
})

describe('isOtherCutFillet', () => {
  it('flags a fillet row that lacks the cut the recipe names', () => {
    expect(isOtherCutFillet('chicken leg fillet', 'chicken thigh fillet')).toBe(true)
    expect(isOtherCutFillet('beef chuck fillet', 'beef fillet')).toBe(true)
  })

  it('keeps a fillet row when the extra word names no cut, or the row is the cut', () => {
    expect(isOtherCutFillet('wild salmon fillet', 'salmon fillet')).toBe(false)
    expect(isOtherCutFillet('salmon fillet portion', 'salmon fillet')).toBe(false)
    expect(isOtherCutFillet('chicken thigh', 'chicken thigh fillet')).toBe(false)
    expect(isOtherCutFillet('chicken leg', 'chicken leg')).toBe(false)
  })
})

// HON-1571: a word in one list and not the other moves a recipe line to another row
describe('the form word lists', () => {
  // A misspelt or dropped word names no form, so its line here goes red, even where
  // the matcher result does not change (PINNED_LINES in the form-words db test)
  it.each([
    ['canned', 'tinned'],
    ['tinned', 'tinned'],
    ['konserveeritud', 'tinned'],
    ['purgi', 'tinned'],
    ['frozen', 'frozen'],
    ['külmutatud', 'frozen'],
    ['dried', 'dried'],
    ['kuivatatud', 'dried'],
    ['smoked', 'smoked'],
    ['suitsutatud', 'smoked'],
    ['pickled', 'pickled'],
    ['marineeritud', 'pickled'],
    ['ground', 'ground'],
    ['jahvatatud', 'ground'],
    ['boneless', 'boneless'],
    ['deboned', 'boneless'],
    ['fillet', 'boneless'],
    ['fillets', 'boneless'],
    ['kondita', 'boneless'],
    ['filee', 'boneless'],
  ])('reads "%s" as the %s form', (word, form) => {
    expect(missingForms(`${word} vesi`, row('ing-water', 'water', 1))).toEqual([form])
  })

  it.each(Object.entries(FORM_WORDS))('names the %s form in English and Estonian', (_, words) => {
    expect(words.en.length).toBeGreaterThan(0)
    expect(words.et.length).toBeGreaterThan(0)
  })

  // Normalization strips these shelf-form and boneless words, but the guard reads
  // the name as written, so both lists apply. A preparation word is in one list only.
  it('shares only the shelf-form and boneless words with the cooking modifiers', () => {
    const words = Object.values(FORM_WORDS).flatMap((form) => [...form.en, ...form.et])

    expect(words.filter((word) => COOKING_MODIFIERS.has(word)).sort()).toEqual([
      'boneless',
      'canned',
      'deboned',
      'dried',
      'frozen',
      'ground',
      'kondita',
      'pickled',
      'smoked',
      'tinned',
    ])
  })
})
