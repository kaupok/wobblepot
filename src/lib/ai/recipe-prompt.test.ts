import { describe, it, expect } from 'vitest'
import { buildRecipeExtractionPrompt, buildRecipeRequest } from './recipe-prompt'

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

  it('appends the Estonian voice block after the locale instruction for "et" only', () => {
    const et = buildRecipeExtractionPrompt('test', 'et')
    expect(et).toContain('ESTONIAN VOICE')
    expect(et).toContain('Karjusepirukas')
    expect(et.indexOf('LOCALE:')).toBeLessThan(et.indexOf('ESTONIAN VOICE'))

    expect(buildRecipeExtractionPrompt('test')).not.toContain('ESTONIAN VOICE')
    expect(buildRecipeExtractionPrompt('test', 'en')).not.toContain('ESTONIAN VOICE')
  })
})

describe('buildRecipeRequest', () => {
  const photo = (byte: string) => ({
    base64: Buffer.from(byte).toString('base64'),
    mimeType: 'image/jpeg',
  })

  it('sends one text prompt and no messages without images', () => {
    const request = buildRecipeRequest('Soup\n- 1 carrot', 'en')
    expect(request).not.toHaveProperty('messages')
    expect(request).toHaveProperty('prompt')
    const prompt = (request as { prompt: string }).prompt
    expect(prompt).toContain('Extract structured data from the following recipe text.')
    expect(prompt).toContain('RECIPE TEXT:\nSoup\n- 1 carrot\n\nRECIPE CONFIDENCE SCORING')
    expect(prompt).not.toContain('RECIPE PHOTOS')
  })

  it('treats an empty image list as no images', () => {
    expect(buildRecipeRequest('Soup', 'en', [])).toEqual(buildRecipeRequest('Soup', 'en'))
  })

  it('sends one image part per photo, then the copy instruction as one text part', () => {
    const request = buildRecipeRequest('Grandma soup', 'et', [photo('a'), photo('b')])
    expect(request).not.toHaveProperty('prompt')
    expect(request).toHaveProperty('messages')

    const { messages } = request as Extract<typeof request, { messages: unknown }>
    expect(messages).toHaveLength(1)
    expect(messages[0]!.role).toBe('user')

    const content = messages[0]!.content
    expect(content.map((part) => part.type)).toEqual(['image', 'image', 'text'])
    expect(content[0]).toEqual({ type: 'image', image: Buffer.from('a'), mediaType: 'image/jpeg' })
    expect(content[1]).toEqual({ type: 'image', image: Buffer.from('b'), mediaType: 'image/jpeg' })

    const text = (content[2] as { text: string }).text
    expect(text).toContain('the recipe shown in the attached photos')
    expect(text).toContain('Copy the recipe shown in the photos')
    expect(text).toContain('do not add ingredients')
    expect(text).toContain('Several photos can be pages of one recipe')
    expect(text).toContain('TEXT FROM THE USER (extra context only):\nGrandma soup')
    expect(text).not.toContain('RECIPE TEXT:')
    // The household locale still decides the output language.
    expect(text).toContain('LOCALE:')
  })

  it('leaves out the user text section when photos come with no text', () => {
    const request = buildRecipeRequest('', 'en', [photo('a')])
    const { messages } = request as Extract<typeof request, { messages: unknown }>
    const text = (messages[0]!.content.at(-1) as { text: string }).text
    expect(text).toContain('RECIPE PHOTOS:')
    expect(text).not.toContain('TEXT FROM THE USER')
  })
})
