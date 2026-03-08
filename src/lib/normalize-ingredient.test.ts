import { describe, it, expect } from 'vitest'
import {
  singularize,
  stripModifiers,
  normalizeIngredientName,
  extractLastWord,
} from './normalize-ingredient'

describe('singularize', () => {
  it('strips simple -s plurals', () => {
    expect(singularize('eggs')).toBe('egg')
    expect(singularize('carrots')).toBe('carrot')
    expect(singularize('onions')).toBe('onion')
    expect(singularize('peppers')).toBe('pepper')
    expect(singularize('mushrooms')).toBe('mushroom')
  })

  it('handles -es plurals after sibilants', () => {
    expect(singularize('sauces')).toBe('sauce')
    expect(singularize('peaches')).toBe('peach')
    expect(singularize('radishes')).toBe('radish')
  })

  it('handles -ies → -y', () => {
    expect(singularize('berries')).toBe('berry')
    expect(singularize('cherries')).toBe('cherry')
    expect(singularize('anchovies')).toBe('anchovy')
  })

  it('handles -ves words that are just -ve + s (not -f plurals)', () => {
    expect(singularize('olives')).toBe('olive')
    expect(singularize('cloves')).toBe('clove')
    expect(singularize('endives')).toBe('endive')
    expect(singularize('chives')).toBe('chives') // false plural
  })

  it('handles irregular culinary plurals', () => {
    expect(singularize('potatoes')).toBe('potato')
    expect(singularize('tomatoes')).toBe('tomato')
    expect(singularize('leaves')).toBe('leaf')
    expect(singularize('loaves')).toBe('loaf')
    expect(singularize('halves')).toBe('half')
  })

  it('preserves false plurals', () => {
    expect(singularize('hummus')).toBe('hummus')
    expect(singularize('couscous')).toBe('couscous')
    expect(singularize('asparagus')).toBe('asparagus')
    expect(singularize('chives')).toBe('chives')
    expect(singularize('oats')).toBe('oats')
    expect(singularize('capers')).toBe('capers')
    expect(singularize('grits')).toBe('grits')
  })

  it('preserves words ending in -ss', () => {
    expect(singularize('grass')).toBe('grass')
    expect(singularize('bass')).toBe('bass')
  })

  it('preserves words ending in -us', () => {
    expect(singularize('asparagus')).toBe('asparagus')
    expect(singularize('citrus')).toBe('citrus')
  })

  it('preserves already-singular words', () => {
    expect(singularize('egg')).toBe('egg')
    expect(singularize('chicken')).toBe('chicken')
    expect(singularize('rice')).toBe('rice')
    expect(singularize('bread')).toBe('bread')
  })

  it('handles short words gracefully', () => {
    expect(singularize('as')).toBe('as')
    expect(singularize('is')).toBe('is')
  })
})

describe('stripModifiers', () => {
  it('strips single cooking modifiers', () => {
    expect(stripModifiers('fresh chives')).toBe('chives')
    expect(stripModifiers('dried basil')).toBe('basil')
    expect(stripModifiers('frozen peas')).toBe('peas')
    expect(stripModifiers('canned tomatoes')).toBe('tomatoes')
    expect(stripModifiers('smoked paprika')).toBe('paprika')
    expect(stripModifiers('ground cumin')).toBe('cumin')
  })

  it('strips multiple leading modifiers', () => {
    expect(stripModifiers('dried ground cumin')).toBe('cumin')
    expect(stripModifiers('boneless skinless chicken breast')).toBe('chicken breast')
    expect(stripModifiers('fresh chopped parsley')).toBe('parsley')
  })

  it('preserves color/identity modifiers (exceptions)', () => {
    expect(stripModifiers('black pepper')).toBe('black pepper')
    expect(stripModifiers('white rice')).toBe('white rice')
    expect(stripModifiers('red wine')).toBe('red wine')
    expect(stripModifiers('green lentils')).toBe('green lentils')
    expect(stripModifiers('sweet potato')).toBe('sweet potato')
    expect(stripModifiers('sour cream')).toBe('sour cream')
  })

  it('preserves names with no modifiers', () => {
    expect(stripModifiers('chicken breast')).toBe('chicken breast')
    expect(stripModifiers('olive oil')).toBe('olive oil')
    expect(stripModifiers('garlic')).toBe('garlic')
  })

  it('never strips the last word (preserves at least one word)', () => {
    expect(stripModifiers('fresh')).toBe('fresh')
    expect(stripModifiers('dried')).toBe('dried')
  })
})

describe('normalizeIngredientName', () => {
  it('normalizes plurals', () => {
    expect(normalizeIngredientName('eggs')).toBe('egg')
    expect(normalizeIngredientName('carrots')).toBe('carrot')
    expect(normalizeIngredientName('tomatoes')).toBe('tomato')
  })

  it('normalizes modifiers + plurals', () => {
    expect(normalizeIngredientName('fresh eggs')).toBe('egg')
    expect(normalizeIngredientName('canned tomatoes')).toBe('tomato')
    expect(normalizeIngredientName('frozen peas')).toBe('pea')
  })

  it('normalizes modifiers without affecting identity words', () => {
    expect(normalizeIngredientName('fresh chives')).toBe('chives')
    expect(normalizeIngredientName('dried basil')).toBe('basil')
  })

  it('preserves identity modifiers', () => {
    expect(normalizeIngredientName('black pepper')).toBe('black pepper')
    expect(normalizeIngredientName('sweet potato')).toBe('sweet potato')
  })

  it('handles case insensitivity', () => {
    expect(normalizeIngredientName('Fresh Chives')).toBe('chives')
    expect(normalizeIngredientName('EGGS')).toBe('egg')
  })

  it('trims whitespace', () => {
    expect(normalizeIngredientName('  eggs  ')).toBe('egg')
  })
})

describe('extractLastWord', () => {
  it('returns last word for multi-word names', () => {
    expect(extractLastWord('black bread')).toBe('bread')
    expect(extractLastWord('fresh chives')).toBe('chives')
    expect(extractLastWord('chicken breast')).toBe('breast')
  })

  it('returns null for single-word names', () => {
    expect(extractLastWord('eggs')).toBeNull()
    expect(extractLastWord('garlic')).toBeNull()
  })

  it('handles whitespace', () => {
    expect(extractLastWord('  black bread  ')).toBe('bread')
  })
})
