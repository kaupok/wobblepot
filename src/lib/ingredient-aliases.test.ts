import { describe, it, expect } from 'vitest'
import { INGREDIENT_ALIASES, applyIngredientAlias, hasIngredientAlias } from './ingredient-aliases'

describe('INGREDIENT_ALIASES', () => {
  it('contains expected common aliases', () => {
    // All aliases must point to ingredients that exist in the database
    expect(INGREDIENT_ALIASES['pepper']).toBe('black pepper')
    expect(INGREDIENT_ALIASES['oil']).toBe('vegetable oil')
    expect(INGREDIENT_ALIASES['rice']).toBe('white rice')
    expect(INGREDIENT_ALIASES['cream']).toBe('heavy cream')
    expect(INGREDIENT_ALIASES['lettuce']).toBe('romaine lettuce')
  })

  it('contains protein aliases', () => {
    expect(INGREDIENT_ALIASES['chicken']).toBe('chicken breast')
    expect(INGREDIENT_ALIASES['beef']).toBe('ground beef')
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
    expect(INGREDIENT_ALIASES['flour']).toBe('all-purpose flour')
    expect(INGREDIENT_ALIASES['sugar']).toBe('granulated sugar')
    expect(INGREDIENT_ALIASES['yeast']).toBe('active dry yeast')
    expect(INGREDIENT_ALIASES['chocolate']).toBe('chocolate chips')
    expect(INGREDIENT_ALIASES['wine']).toBe('red wine')
    expect(INGREDIENT_ALIASES['mustard']).toBe('yellow mustard')
    expect(INGREDIENT_ALIASES['yogurt']).toBe('plain yogurt')
    expect(INGREDIENT_ALIASES['miso']).toBe('white miso paste')
    expect(INGREDIENT_ALIASES['vinegar']).toBe('white vinegar')
    expect(INGREDIENT_ALIASES['soy sauce']).toBe('light soy sauce')
    expect(INGREDIENT_ALIASES['vietnamese fish sauce']).toBe('fish sauce')
  })

  it('contains audit quick-win aliases', () => {
    expect(INGREDIENT_ALIASES['azuki beans']).toBe('adzuki beans')
    expect(INGREDIENT_ALIASES['sichuan peppercorn']).toBe('szechuan peppercorn')
    expect(INGREDIENT_ALIASES['capsicum']).toBe('bell pepper')
    expect(INGREDIENT_ALIASES['swede']).toBe('rutabaga')
    expect(INGREDIENT_ALIASES['sultanas']).toBe('raisins')
    expect(INGREDIENT_ALIASES['bicarbonate of soda']).toBe('baking soda')
    expect(INGREDIENT_ALIASES['icing sugar']).toBe('powdered sugar')
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

  it('does not contain aliases that would degrade direct matches', () => {
    // These ingredients exist in the DB directly, so no alias needed
    expect(INGREDIENT_ALIASES['onion']).toBeUndefined()
    expect(INGREDIENT_ALIASES['milk']).toBeUndefined()
    expect(INGREDIENT_ALIASES['butter']).toBeUndefined()
    expect(INGREDIENT_ALIASES['basil']).toBeUndefined()
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
    expect(applyIngredientAlias('flour')).toBe('all-purpose flour')
    expect(applyIngredientAlias('sugar')).toBe('granulated sugar')
    expect(applyIngredientAlias('mustard')).toBe('yellow mustard')
    expect(applyIngredientAlias('vinegar')).toBe('white vinegar')
    expect(applyIngredientAlias('Vietnamese fish sauce')).toBe('fish sauce')
  })

  it('expands audit quick-win aliases', () => {
    expect(applyIngredientAlias('Capsicum')).toBe('bell pepper')
    expect(applyIngredientAlias('SULTANAS')).toBe('raisins')
    expect(applyIngredientAlias('Bicarbonate of Soda')).toBe('baking soda')
    expect(applyIngredientAlias('extra virgin olive oil')).toBe('olive oil')
    expect(applyIngredientAlias('Lemon Juice')).toBe('lemon')
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
