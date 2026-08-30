import { describe, it, expect } from 'vitest'
import { buildRecipeExtractionPrompt } from './recipe-prompt'

describe('buildRecipeExtractionPrompt', () => {
  it('includes the recipe text', () => {
    const prompt = buildRecipeExtractionPrompt('My delicious recipe')
    expect(prompt).toContain('My delicious recipe')
  })

  it('includes vague phrases list', () => {
    const prompt = buildRecipeExtractionPrompt('test')
    expect(prompt).toContain('to taste')
    expect(prompt).toContain('a pinch')
    expect(prompt).toContain('for garnish')
  })

  it('includes unit conversion guidelines', () => {
    const prompt = buildRecipeExtractionPrompt('test')
    expect(prompt).toContain('tbsp')
    expect(prompt).toContain('tsp')
    expect(prompt).toContain('cup')
  })

  it('includes ingredient specificity guidelines', () => {
    const prompt = buildRecipeExtractionPrompt('test')
    expect(prompt).toContain('black pepper')
    expect(prompt).toContain('olive oil')
  })

  it('includes confidence scoring guidelines', () => {
    const prompt = buildRecipeExtractionPrompt('test')
    expect(prompt).toContain('RECIPE CONFIDENCE SCORING')
    expect(prompt).toContain('90-100')
    expect(prompt).toContain('not a recipe')
  })

  it('omits the locale instruction for English / default locale', () => {
    expect(buildRecipeExtractionPrompt('test')).not.toContain('LOCALE:')
    expect(buildRecipeExtractionPrompt('test', 'en')).not.toContain('LOCALE:')
  })

  it('injects an Estonian output instruction when locale is "et"', () => {
    const prompt = buildRecipeExtractionPrompt('test', 'et')
    expect(prompt).toContain('LOCALE:')
    expect(prompt).toContain('Estonian')
  })
})
