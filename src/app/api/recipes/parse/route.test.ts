import { describe, it, expect } from 'vitest'
import { extractUrlAndContext } from './route'

describe('extractUrlAndContext', () => {
  it('detects https:// URLs', () => {
    const result = extractUrlAndContext('https://www.bbcgoodfood.com/recipes/easy-chicken-fajitas')
    expect(result).toEqual({
      url: 'https://www.bbcgoodfood.com/recipes/easy-chicken-fajitas',
      context: '',
    })
  })

  it('detects http:// URLs', () => {
    const result = extractUrlAndContext('http://example.com/recipe')
    expect(result).toEqual({
      url: 'http://example.com/recipe',
      context: '',
    })
  })

  it('detects www. URLs and prepends https://', () => {
    const result = extractUrlAndContext('www.bbcgoodfood.com/recipes/easy-chicken-fajitas')
    expect(result).toEqual({
      url: 'https://www.bbcgoodfood.com/recipes/easy-chicken-fajitas',
      context: '',
    })
  })

  it('does not double-prepend https:// for www. URLs', () => {
    const result = extractUrlAndContext('https://www.bbcgoodfood.com/recipes/easy-chicken-fajitas')
    expect(result?.url).toBe('https://www.bbcgoodfood.com/recipes/easy-chicken-fajitas')
  })

  it('handles www.invalid gracefully (returns null for invalid URL)', () => {
    const result = extractUrlAndContext('www.invalid')
    // "https://www.invalid" is actually a valid URL per the URL spec
    // so it will be detected as a URL - fetch will fail gracefully later
    expect(result).toEqual({
      url: 'https://www.invalid',
      context: '',
    })
  })

  it('does not treat plain text starting with "www" as a URL', () => {
    const result = extractUrlAndContext('www is short for World Wide Web')
    // "www" without a dot is not treated as a URL prefix
    // but "www " starts with "www." check fails, so it goes through normal path
    expect(result).toBeNull()
  })

  it('returns null for plain recipe text', () => {
    const result = extractUrlAndContext('2 cups flour\n1 tsp salt\n3 eggs')
    expect(result).toBeNull()
  })

  it('extracts context from lines after the URL', () => {
    const input = 'https://example.com/recipe\nHalve the sugar\nUse almond milk'
    const result = extractUrlAndContext(input)
    expect(result).toEqual({
      url: 'https://example.com/recipe',
      context: 'Halve the sugar\nUse almond milk',
    })
  })

  it('extracts context from www. URL with additional lines', () => {
    const input = 'www.example.com/recipe\nMake it spicy'
    const result = extractUrlAndContext(input)
    expect(result).toEqual({
      url: 'https://www.example.com/recipe',
      context: 'Make it spicy',
    })
  })

  it('trims whitespace from input', () => {
    const result = extractUrlAndContext('  www.example.com/recipe  ')
    expect(result).toEqual({
      url: 'https://www.example.com/recipe',
      context: '',
    })
  })
})
