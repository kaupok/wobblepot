import { describe, it, expect } from 'vitest'
import {
  INGREDIENT_ALIASES,
  INGREDIENT_SYNONYMS,
  applyIngredientAlias,
  hasIngredientAlias,
} from './ingredient-aliases'

describe('INGREDIENT_ALIASES', () => {
  it('contains expected common aliases', () => {
    // All aliases must point to ingredients that exist in the database
    expect(INGREDIENT_ALIASES['pepper']).toBe('black pepper')
    expect(INGREDIENT_ALIASES['oil']).toBe('vegetable oil')
    expect(INGREDIENT_ALIASES['rice']).toBe('white rice')
    expect(INGREDIENT_ALIASES['cream']).toBe('double cream')
    expect(INGREDIENT_ALIASES['lettuce']).toBe('romaine lettuce')
  })

  it('contains protein aliases', () => {
    expect(INGREDIENT_ALIASES['chicken']).toBe('chicken breast')
    expect(INGREDIENT_ALIASES['beef']).toBe('beef mince')
    expect(INGREDIENT_ALIASES['pork']).toBe('pork loin')
    expect(INGREDIENT_ALIASES['fish']).toBe('salmon fillet')
  })

  it('contains legume aliases', () => {
    expect(INGREDIENT_ALIASES['beans']).toBe('black beans')
    expect(INGREDIENT_ALIASES['lentils']).toBe('green lentils')
  })

  it('contains multi-word keys', () => {
    expect(INGREDIENT_ALIASES['cooking oil']).toBe('vegetable oil')
  })

  it('contains baking and condiment aliases', () => {
    expect(INGREDIENT_ALIASES['flour']).toBe('plain flour')
    expect(INGREDIENT_ALIASES['sugar']).toBe('granulated sugar')
    expect(INGREDIENT_ALIASES['yeast']).toBe('active dry yeast')
    expect(INGREDIENT_ALIASES['chocolate']).toBe('chocolate chips')
    expect(INGREDIENT_ALIASES['wine']).toBe('red wine')
    expect(INGREDIENT_ALIASES['mustard']).toBe('yellow mustard')
    expect(INGREDIENT_ALIASES['yogurt']).toBe('natural yogurt')
    expect(INGREDIENT_ALIASES['miso']).toBe('white miso paste')
    expect(INGREDIENT_ALIASES['vinegar']).toBe('white vinegar')
    expect(INGREDIENT_ALIASES['soy sauce']).toBe('light soy sauce')
    expect(INGREDIENT_ALIASES['vietnamese fish sauce']).toBe('fish sauce')
  })

  it('contains audit quick-win aliases', () => {
    expect(INGREDIENT_ALIASES['azuki beans']).toBe('adzuki beans')
    expect(INGREDIENT_ALIASES['sichuan peppercorn']).toBe('szechuan peppercorn')
    expect(INGREDIENT_ALIASES['sultanas']).toBe('raisins')
    expect(INGREDIENT_ALIASES['ginger powder']).toBe('ground ginger')
    expect(INGREDIENT_ALIASES['lemon juice']).toBe('lemon')
    expect(INGREDIENT_ALIASES['lime juice']).toBe('lime')
    expect(INGREDIENT_ALIASES['tomato juice']).toBe('tomato')
    expect(INGREDIENT_ALIASES['extra virgin olive oil']).toBe('olive oil')
  })

  it('contains Indian ingredient aliases', () => {
    expect(INGREDIENT_ALIASES['besan']).toBe('chickpea flour')
    expect(INGREDIENT_ALIASES['gram flour']).toBe('chickpea flour')
    expect(INGREDIENT_ALIASES['atta flour']).toBe('chapati flour')
    expect(INGREDIENT_ALIASES['atta']).toBe('chapati flour')
    expect(INGREDIENT_ALIASES['tamarind paste']).toBe('tamarind puree')
    expect(INGREDIENT_ALIASES['tamarind']).toBe('tamarind puree')
    expect(INGREDIENT_ALIASES['carom seeds']).toBe('ajwain seeds')
    expect(INGREDIENT_ALIASES['dried fenugreek leaves']).toBe('kasuri methi')
    expect(INGREDIENT_ALIASES['methi leaves']).toBe('kasuri methi')
    expect(INGREDIENT_ALIASES['achar']).toBe('Indian pickle')
  })

  it('contains Mexican ingredient aliases', () => {
    expect(INGREDIENT_ALIASES['chile guajillo']).toBe('guajillo chilli')
    expect(INGREDIENT_ALIASES['dried guajillo']).toBe('guajillo chilli')
    expect(INGREDIENT_ALIASES['chile pasilla']).toBe('pasilla chilli')
    expect(INGREDIENT_ALIASES['dried pasilla']).toBe('pasilla chilli')
    expect(INGREDIENT_ALIASES['chile de arbol']).toBe('arbol chilli')
    expect(INGREDIENT_ALIASES['chile de árbol']).toBe('arbol chilli')
    expect(INGREDIENT_ALIASES['dried arbol']).toBe('arbol chilli')
    expect(INGREDIENT_ALIASES['oaxaca cheese']).toBe('queso oaxaca')
    expect(INGREDIENT_ALIASES['quesillo']).toBe('queso oaxaca')
    expect(INGREDIENT_ALIASES['corn truffle']).toBe('huitlacoche')
    expect(INGREDIENT_ALIASES['cuitlacoche']).toBe('huitlacoche')
    expect(INGREDIENT_ALIASES['mexican raw sugar']).toBe('piloncillo')
    expect(INGREDIENT_ALIASES['panela sugar']).toBe('piloncillo')
  })

  it('contains Ethiopian ingredient aliases', () => {
    expect(INGREDIENT_ALIASES['berbere spice']).toBe('berbere')
    expect(INGREDIENT_ALIASES['berbere seasoning']).toBe('berbere')
    expect(INGREDIENT_ALIASES['ethiopian cardamom']).toBe('korarima')
    expect(INGREDIENT_ALIASES['ethiopian sacred basil']).toBe('besobela')
    expect(INGREDIENT_ALIASES['sacred basil']).toBe('besobela')
    expect(INGREDIENT_ALIASES['spiced butter']).toBe('niter kibbeh')
    expect(INGREDIENT_ALIASES['ethiopian spiced butter']).toBe('niter kibbeh')
    expect(INGREDIENT_ALIASES['kibbeh butter']).toBe('niter kibbeh')
    expect(INGREDIENT_ALIASES['shiro']).toBe('shiro powder')
    expect(INGREDIENT_ALIASES['chickpea flour blend']).toBe('shiro powder')
    expect(INGREDIENT_ALIASES['awaze']).toBe('awaze paste')
    expect(INGREDIENT_ALIASES['ethiopian chili paste']).toBe('awaze paste')
  })

  it('contains Japanese pantry aliases', () => {
    expect(INGREDIENT_ALIASES['dashi stock']).toBe('dashi')
    expect(INGREDIENT_ALIASES['dashi broth']).toBe('dashi')
    expect(INGREDIENT_ALIASES['wasabi']).toBe('wasabi paste')
    expect(INGREDIENT_ALIASES['tsuyu']).toBe('mentsuyu')
    expect(INGREDIENT_ALIASES['soybean flour']).toBe('kinako')
    expect(INGREDIENT_ALIASES['curry roux']).toBe('Japanese curry roux')
  })

  it('contains West African ingredient aliases', () => {
    expect(INGREDIENT_ALIASES['iru']).toBe('dawadawa')
    expect(INGREDIENT_ALIASES['locust bean condiment']).toBe('dawadawa')
    expect(INGREDIENT_ALIASES['yaji spice']).toBe('suya spice')
    expect(INGREDIENT_ALIASES['yaji']).toBe('suya spice')
    expect(INGREDIENT_ALIASES['cassava couscous']).toBe('attieke')
    expect(INGREDIENT_ALIASES['attiéké']).toBe('attieke')
    expect(INGREDIENT_ALIASES['african basil']).toBe('scent leaf')
    expect(INGREDIENT_ALIASES['dika seeds']).toBe('ogbono seeds')
    expect(INGREDIENT_ALIASES['melon seeds']).toBe('egusi seeds')
  })

  it('contains Mediterranean and French aliases', () => {
    expect(INGREDIENT_ALIASES['parmigiano-reggiano']).toBe('parmesan')
    expect(INGREDIENT_ALIASES['parmigiano reggiano']).toBe('parmesan')
    expect(INGREDIENT_ALIASES['phyllo pastry']).toBe('filo pastry')
    expect(INGREDIENT_ALIASES['filo dough']).toBe('filo pastry')
    expect(INGREDIENT_ALIASES['filo']).toBe('filo pastry')
    expect(INGREDIENT_ALIASES['french green beans']).toBe('haricots verts')
    expect(INGREDIENT_ALIASES['calabrian chili paste']).toBe('calabrian chilli')
    expect(INGREDIENT_ALIASES['calabrian chili pepper']).toBe('calabrian chilli')
    expect(INGREDIENT_ALIASES['calabrian pepper']).toBe('calabrian chilli')
    expect(INGREDIENT_ALIASES['sopressata']).toBe('soppressata')
    expect(INGREDIENT_ALIASES['apple brandy']).toBe('calvados')
  })

  it('does not contain aliases that would degrade direct matches', () => {
    // These ingredients exist in the DB directly, so no alias needed
    expect(INGREDIENT_ALIASES['onion']).toBeUndefined()
    expect(INGREDIENT_ALIASES['milk']).toBeUndefined()
    expect(INGREDIENT_ALIASES['butter']).toBeUndefined()
    expect(INGREDIENT_ALIASES['basil']).toBeUndefined()
  })
})

// HON-1100: other English names for the same row, shown next to it in search.
describe('INGREDIENT_SYNONYMS', () => {
  it('maps other English names to the pool name', () => {
    expect(INGREDIENT_SYNONYMS['all-purpose flour']).toBe('plain flour')
    expect(INGREDIENT_SYNONYMS['powdered sugar']).toBe('icing sugar')
    expect(INGREDIENT_SYNONYMS['confectioners sugar']).toBe('icing sugar')
    expect(INGREDIENT_SYNONYMS['cornstarch']).toBe('cornflour')
    expect(INGREDIENT_SYNONYMS['rutabaga']).toBe('swede')
    expect(INGREDIENT_SYNONYMS['capsicum']).toBe('bell pepper')
    expect(INGREDIENT_SYNONYMS['garbanzo beans']).toBe('chickpeas')
  })

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

  // HON-1099: a pasted American recipe still matches the renamed pool row.
  it('resolves the American name of a renamed pool row to its British name', () => {
    expect(applyIngredientAlias('cornstarch')).toBe('cornflour')
    expect(applyIngredientAlias('Baking Soda')).toBe('bicarbonate of soda')
    expect(applyIngredientAlias('powdered sugar')).toBe('icing sugar')
    expect(applyIngredientAlias('corn meal')).toBe('cornmeal')
    expect(applyIngredientAlias('canned diced tomatoes')).toBe('tinned chopped tomatoes')
    expect(applyIngredientAlias('red bell pepper')).toBe('red pepper')
    expect(applyIngredientAlias('half and half')).toBe('single cream')
    expect(applyIngredientAlias('guajillo chili')).toBe('guajillo chilli')
  })

  it('points the aliases of a renamed pool row at its British name', () => {
    expect(applyIngredientAlias('chopped tomatoes')).toBe('tinned chopped tomatoes')
    expect(applyIngredientAlias('chile de arbol')).toBe('arbol chilli')
    expect(applyIngredientAlias('filo')).toBe('filo pastry')
    expect(applyIngredientAlias('yogurt')).toBe('natural yogurt')
    // "cornmeal" is the pool name now, not an alias of "corn meal".
    expect(applyIngredientAlias('cornmeal')).toBe('cornmeal')
  })

  it('points the aliases of a merged row at its British twin', () => {
    expect(applyIngredientAlias('cream')).toBe('double cream')
    expect(applyIngredientAlias('minced pork')).toBe('pork mince')
    expect(applyIngredientAlias('coriander leaves')).toBe('fresh coriander')
    expect(hasIngredientAlias('fresh coriander')).toBe(false)
  })

  it('does not send the British name of a renamed row to another row', () => {
    for (const name of ['courgette', 'aubergine', 'rocket', 'passata']) {
      expect(hasIngredientAlias(name)).toBe(false)
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

  it('expands baking and condiment aliases', () => {
    expect(applyIngredientAlias('flour')).toBe('plain flour')
    expect(applyIngredientAlias('sugar')).toBe('granulated sugar')
    expect(applyIngredientAlias('mustard')).toBe('yellow mustard')
    expect(applyIngredientAlias('vinegar')).toBe('white vinegar')
    expect(applyIngredientAlias('Vietnamese fish sauce')).toBe('fish sauce')
  })

  it('expands audit quick-win aliases', () => {
    expect(applyIngredientAlias('Capsicum')).toBe('bell pepper')
    expect(applyIngredientAlias('SULTANAS')).toBe('raisins')
    expect(applyIngredientAlias('Bicarb')).toBe('bicarbonate of soda')
    expect(applyIngredientAlias('extra virgin olive oil')).toBe('olive oil')
    expect(applyIngredientAlias('Lemon Juice')).toBe('lemon')
  })

  it('resolves another English name to the pool name', () => {
    expect(applyIngredientAlias('All-Purpose Flour')).toBe('plain flour')
    expect(applyIngredientAlias('powdered sugar')).toBe('icing sugar')
    expect(hasIngredientAlias('all-purpose flour')).toBe(true)
    // The British name is the pool name now, so it passes through unchanged.
    expect(applyIngredientAlias('plain flour')).toBe('plain flour')
    expect(hasIngredientAlias('plain flour')).toBe(false)
  })

  it('expands Japanese pantry aliases', () => {
    expect(applyIngredientAlias('dashi stock')).toBe('dashi')
    expect(applyIngredientAlias('Dashi Broth')).toBe('dashi')
    expect(applyIngredientAlias('wasabi')).toBe('wasabi paste')
    expect(applyIngredientAlias('Tsuyu')).toBe('mentsuyu')
    expect(applyIngredientAlias('Curry Roux')).toBe('Japanese curry roux')
  })

  it('expands West African ingredient aliases', () => {
    expect(applyIngredientAlias('iru')).toBe('dawadawa')
    expect(applyIngredientAlias('Yaji Spice')).toBe('suya spice')
    expect(applyIngredientAlias('cassava couscous')).toBe('attieke')
    expect(applyIngredientAlias('African Basil')).toBe('scent leaf')
    expect(applyIngredientAlias('dika seeds')).toBe('ogbono seeds')
  })

  it('returns original name for ingredients that should match directly', () => {
    // These ingredients exist in the DB, so they should pass through unchanged
    expect(applyIngredientAlias('onion')).toBe('onion')
    expect(applyIngredientAlias('milk')).toBe('milk')
    expect(applyIngredientAlias('butter')).toBe('butter')
  })

  it('handles multi-word aliases', () => {
    expect(applyIngredientAlias('cooking oil')).toBe('vegetable oil')
  })
})

describe('hasIngredientAlias', () => {
  it('returns true for known aliases', () => {
    expect(hasIngredientAlias('pepper')).toBe(true)
    expect(hasIngredientAlias('rice')).toBe(true)
    expect(hasIngredientAlias('chicken')).toBe(true)
    expect(hasIngredientAlias('cooking oil')).toBe(true)
  })

  it('returns false for unknown ingredients', () => {
    expect(hasIngredientAlias('quinoa')).toBe(false)
    expect(hasIngredientAlias('tofu')).toBe(false)
    expect(hasIngredientAlias('black pepper')).toBe(false) // This is the expanded form, not an alias
  })

  it('returns true for new baking/condiment aliases', () => {
    expect(hasIngredientAlias('flour')).toBe(true)
    expect(hasIngredientAlias('sugar')).toBe(true)
    expect(hasIngredientAlias('vinegar')).toBe(true)
    expect(hasIngredientAlias('miso')).toBe(true)
  })

  it('returns false for ingredients that should match directly', () => {
    // These ingredients exist in the DB directly, so no alias needed
    expect(hasIngredientAlias('onion')).toBe(false)
    expect(hasIngredientAlias('milk')).toBe(false)
    expect(hasIngredientAlias('butter')).toBe(false)
  })

  it('handles case insensitively', () => {
    expect(hasIngredientAlias('PEPPER')).toBe(true)
    expect(hasIngredientAlias('Rice')).toBe(true)
  })
})
