import { describe, expect, it } from 'vitest'

import {
  applyIngredientAlias,
  findSynonym,
  INGREDIENT_ALIASES,
  INGREDIENT_SYNONYMS,
  synonymKey,
} from './ingredient-aliases'
import { findSynonymMatches } from './ingredient-synonym-match'

describe('INGREDIENT_ALIASES', () => {
  it('does not contain aliases that would degrade direct matches', () => {
    // These ingredients exist in the DB directly, so no alias needed
    expect(INGREDIENT_ALIASES['onion']).toBeUndefined()
    expect(INGREDIENT_ALIASES['milk']).toBeUndefined()
    expect(INGREDIENT_ALIASES['butter']).toBeUndefined()
    expect(INGREDIENT_ALIASES['basil']).toBeUndefined()
  })
})

// HON-1262: a dumpling's dish word expands to its most common filling.
describe('filled dumplings', () => {
  it('expands the dish word and resolves the other spellings', () => {
    expect(applyIngredientAlias('pelmeni')).toBe('pork and beef pelmeni')
    expect(applyIngredientAlias('Gyoza')).toBe('pork gyoza')
    expect(applyIngredientAlias('hinkali')).toBe('khinkali')
    expect(applyIngredientAlias('dumplings')).toBe('dumplings')
  })

  it('shows the other wrapper names next to gyoza wrappers in search', () => {
    expect(findSynonymMatches('dumpling wr')).toEqual([
      expect.objectContaining({ target: 'gyoza wrappers', synonym: 'dumpling wrappers' }),
    ])
  })
})

// HON-1100: other English names for the same row, shown next to it in search.
describe('INGREDIENT_SYNONYMS', () => {
  // HON-1083: a pasted American recipe still matches the renamed seeded row.
  it('resolves the American name of a renamed seeded row to its British name', () => {
    expect(applyIngredientAlias('zucchini')).toBe('courgette')
    expect(applyIngredientAlias('Ground Beef')).toBe('beef mince')
    expect(applyIngredientAlias('eggplant')).toBe('aubergine')
    expect(applyIngredientAlias('tomato sauce')).toBe('passata')
    expect(applyIngredientAlias('goat cheese')).toBe("goat's cheese")
  })

  // HON-1097: a pasted American recipe matches the British row it merged into.
  it('resolves the American name of a merged row to its British twin', () => {
    expect(applyIngredientAlias('shrimp')).toBe('prawns')
    expect(applyIngredientAlias('Ground Lamb')).toBe('lamb mince')
    expect(applyIngredientAlias('heavy cream')).toBe('double cream')
    expect(applyIngredientAlias('cilantro')).toBe('fresh coriander')
    expect(applyIngredientAlias('red chili pepper')).toBe('red chilli')
    expect(applyIngredientAlias('chicken broth')).toBe('chicken stock')
  })

  // HON-1500: a recipe that names a merged row matches the row it merged into.
  it('resolves the name of a merged same-food row to the row that stays', () => {
    expect(applyIngredientAlias('oats')).toBe('rolled oats')
    expect(applyIngredientAlias('Chicken Fillet')).toBe('chicken breast')
    expect(applyIngredientAlias('great northern beans')).toBe('white beans')
    expect(applyIngredientAlias('navy beans')).toBe('white beans')
    expect(applyIngredientAlias('mangetout')).toBe('sugar snap peas')
    expect(applyIngredientAlias('korean kelp')).toBe('kombu')
  })

  // HON-1551: tomato purée merged into passata.
  it('resolves tomato purée to passata', () => {
    expect(applyIngredientAlias('tomato puree')).toBe('passata')
    expect(applyIngredientAlias('Tomato Purée')).toBe('passata')
    expect(applyIngredientAlias('tomatipüree')).toBe('tomato paste')
  })

  // HON-1552: tinned coconut milk merged into coconut milk.
  it('resolves tinned coconut milk to coconut milk', () => {
    expect(applyIngredientAlias('tinned coconut milk')).toBe('coconut milk')
    expect(applyIngredientAlias('Canned Coconut Milk')).toBe('coconut milk')
    expect(applyIngredientAlias('coconut milk canned')).toBe('coconut milk')
  })

  // HON-1099: a pasted American recipe still matches the renamed pool row.
  it('resolves the American name of a renamed pool row to its British name', () => {
    expect(applyIngredientAlias('cornstarch')).toBe('cornflour')
    expect(applyIngredientAlias('Baking Soda')).toBe('bicarbonate of soda')
    expect(applyIngredientAlias('powdered sugar')).toBe('icing sugar')
    expect(applyIngredientAlias('corn meal')).toBe('cornmeal')
    expect(applyIngredientAlias('canned diced tomatoes')).toBe('tinned chopped tomatoes')
    expect(applyIngredientAlias('canned chopped tomatoes')).toBe('tinned chopped tomatoes')
    expect(applyIngredientAlias('red bell pepper')).toBe('red pepper')
    expect(applyIngredientAlias('half and half')).toBe('single cream')
    expect(applyIngredientAlias('guajillo chili')).toBe('guajillo chilli')
  })

  it('reads hyphens as spaces and drops apostrophes in the synonym key', () => {
    expect(synonymKey('  All-Purpose   Flour ')).toBe('all purpose flour')
    expect(synonymKey('Confectioners’ Sugar')).toBe('confectioners sugar')
  })

  // HON-1099 review: a trigram search ignored hyphens and spacing, so these
  // spellings found the old American row by name. The synonym lookup must too.
  it.each([
    ['all purpose flour', 'plain flour'],
    ['All-Purpose  Flour', 'plain flour'],
    ['half-and-half', 'single cream'],
    ['whole-wheat flour', 'wholemeal flour'],
    ['black eyed peas', 'black-eyed beans'],
    ["confectioners' sugar", 'icing sugar'],
    ['corn starch', 'cornflour'],
    ['cornish game hen', 'poussin'],
    ['phyllo', 'filo pastry'],
  ])('resolves the spelling "%s" to %s', (pasted, pool) => {
    expect(applyIngredientAlias(pasted)).toBe(pool)
    expect(findSynonym(pasted)).toBe(pool)
  })

  it('leaves a pool name alone whatever its spelling', () => {
    expect(findSynonym('black-eyed beans')).toBeUndefined()
    expect(findSynonym("goat's cheese")).toBeUndefined()
    expect(applyIngredientAlias('plain flour')).toBe('plain flour')
  })

  it('does not send the British name of a renamed row to another row', () => {
    for (const name of ['courgette', 'aubergine', 'rocket', 'passata']) {
      expect(applyIngredientAlias(name)).toBe(name)
    }
    expect(applyIngredientAlias('mince')).toBe('beef mince')
    expect(applyIngredientAlias('red pepper flakes')).toBe('chilli flakes')
  })

  it('has lowercase keys', () => {
    for (const key of Object.keys(INGREDIENT_SYNONYMS)) {
      expect(key).toBe(key.toLowerCase())
    }
  })

  it('shares no key with INGREDIENT_ALIASES', () => {
    const shared = Object.keys(INGREDIENT_SYNONYMS).filter((key) => key in INGREDIENT_ALIASES)
    expect(shared).toEqual([])
  })
})

describe('applyIngredientAlias', () => {
  it('expands known aliases', () => {
    expect(applyIngredientAlias('pepper')).toBe('black pepper')
    expect(applyIngredientAlias('rice')).toBe('white rice')
    expect(applyIngredientAlias('chicken')).toBe('chicken breast')
  })

  it('handles case insensitively', () => {
    expect(applyIngredientAlias('PEPPER')).toBe('black pepper')
    expect(applyIngredientAlias('Rice')).toBe('white rice')
    expect(applyIngredientAlias('CHICKEN')).toBe('chicken breast')
  })

  it('handles whitespace', () => {
    expect(applyIngredientAlias('  pepper  ')).toBe('black pepper')
    expect(applyIngredientAlias('\trice\n')).toBe('white rice')
  })

  it('returns original name for unknown ingredients', () => {
    expect(applyIngredientAlias('quinoa')).toBe('quinoa')
    expect(applyIngredientAlias('tofu')).toBe('tofu')
    expect(applyIngredientAlias('some random ingredient')).toBe('some random ingredient')
  })
})
