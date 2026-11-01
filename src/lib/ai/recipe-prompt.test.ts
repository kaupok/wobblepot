import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { buildRecipeExtractionPrompt, buildRecipeRequest } from './recipe-prompt'

// Each build makes a new Zod schema, and two instances never deep-equal, so
// compare the JSON Schema the provider receives instead.
function withJsonSchema(request: object) {
  return { ...request, schema: z.toJSONSchema((request as { schema: z.ZodType }).schema) }
}

describe('buildRecipeExtractionPrompt', () => {
  it('includes the recipe text', () => {
    const prompt = buildRecipeExtractionPrompt('My delicious recipe', 4)
    expect(prompt).toContain('My delicious recipe')
  })

  it('includes vague phrases list', () => {
    const prompt = buildRecipeExtractionPrompt('test', 4)
    expect(prompt).toContain('to taste')
    expect(prompt).toContain('a pinch')
    expect(prompt).toContain('for garnish')
  })

  it('includes unit conversion guidelines', () => {
    const prompt = buildRecipeExtractionPrompt('test', 4)
    expect(prompt).toContain('tbsp')
    expect(prompt).toContain('tsp')
    expect(prompt).toContain('cup')
  })

  it('includes ingredient specificity guidelines', () => {
    const prompt = buildRecipeExtractionPrompt('test', 4)
    expect(prompt).toContain('black pepper')
    expect(prompt).toContain('olive oil')
  })

  it("tells the model to fall back to the household's size, not a fixed 4 (HON-1363)", () => {
    const prompt = buildRecipeExtractionPrompt('Soup\n- 1 carrot', 3)
    expect(prompt).toContain("6. If servings aren't specified, default to 3\n")
    expect(prompt).not.toContain('default to 4')
  })

  it('converts a cooked rice, pasta or lentil weight to dry weight (HON-1473)', () => {
    const prompt = buildRecipeExtractionPrompt('test', 4)
    expect(prompt).toContain(
      'If the recipe gives a cooked weight, convert it to dry: cooked rice, grains, lentils',
    )
    expect(prompt).toContain('drained canned beans')
  })

  it('gives mung, adzuki and soy beans as dry and converts a cooked weight of them to dry (HON-1550)', () => {
    const prompt = buildRecipeExtractionPrompt('test', 4)
    expect(prompt).toContain(
      'Give every weight as bought: dry rice, pasta, grains and lentils, dry mung, adzuki and soy beans, drained canned beans',
    )
    expect(prompt).toContain(
      'If the recipe gives a cooked weight, convert it to dry: cooked rice, grains, lentils, or mung, adzuki or soy beans × 0.4, cooked pasta or noodles × 0.45',
    )
    expect(prompt).toContain(
      'Drained canned lentils, and canned mung, adzuki or soy beans, are cooked: 1 can ≈ 240g cooked, so convert it to dry with the × 0.4 rule below (≈ 96g)',
    )
  })

  it('keeps a dried bean or chickpea weight as written, with "dried" in the name (HON-1549)', () => {
    const prompt = buildRecipeExtractionPrompt('test', 4)
    expect(prompt).toContain(
      'Dried beans and chickpeas are sold dry: keep "dried" in the name and the weight as written, even when the recipe soaks or cooks them. Do not convert a dried weight to drained or canned',
    )
    expect(prompt).toContain(
      'Example: "250 g dried chickpeas, soaked overnight" → quantity: 250, unit: "g", name: "dried chickpeas"',
    )
  })

  it('weighs a drained can of beans or chickpeas at 240g, converts drained canned lentils to dry, and keeps an undrained can at 400g (HON-1489)', () => {
    const prompt = buildRecipeExtractionPrompt('test', 4)
    expect(prompt).toContain(
      'Drained canned beans and chickpeas weigh less: 1 can, drained ≈ 240g. That is already the as-bought weight, so do not convert it to dry. Drained canned lentils',
    )
    expect(prompt).toContain(
      'Example: "2 cans chickpeas, drained" → quantity: 480, unit: "g", name: "chickpeas"',
    )
    expect(prompt).toContain('Convert to grams: 1 standard can ≈ 400g')
    expect(prompt).toContain(
      'Example: "1 can coconut milk" → quantity: 400, unit: "g", name: "coconut milk"',
    )
  })

  it('keeps the boneless or bone-in form and weighs a bone-in cut with the bone (HON-1480)', () => {
    const prompt = buildRecipeExtractionPrompt('test', 4)
    expect(prompt).toContain(
      '"boneless", "fillet" or "meat" on chicken thigh or a fish means its fillet row: "boneless skinless chicken thighs" → "chicken thigh fillet"',
    )
    expect(prompt).toContain(
      'Any other cut keeps its bare name, boneless or not: "boneless beef chuck" → "beef chuck"',
    )
    expect(prompt).toContain(
      'A cut given in pieces is weighed: a bone-in cut with the bone, a boneless cut without it. "4 chicken thighs" → quantity: 600, unit: "g", name: "chicken thigh"; "4 boneless chicken thighs" → quantity: 400, unit: "g", name: "chicken thigh fillet"',
    )
  })

  it('includes confidence scoring guidelines', () => {
    const prompt = buildRecipeExtractionPrompt('test', 4)
    expect(prompt).toContain('RECIPE CONFIDENCE SCORING')
    expect(prompt).toContain('90-100')
    expect(prompt).toContain('not a recipe')
  })

  it('omits the locale instruction for English / default locale', () => {
    expect(buildRecipeExtractionPrompt('test', 4)).not.toContain('LOCALE:')
    expect(buildRecipeExtractionPrompt('test', 4, 'en')).not.toContain('LOCALE:')
  })

  it('injects an Estonian output instruction when locale is "et"', () => {
    const prompt = buildRecipeExtractionPrompt('test', 4, 'et')
    expect(prompt).toContain('LOCALE:')
    expect(prompt).toContain('Estonian')
  })

  it('appends the Estonian voice block after the locale instruction for "et" only', () => {
    const et = buildRecipeExtractionPrompt('test', 4, 'et')
    expect(et).toContain('ESTONIAN VOICE')
    expect(et).toContain('Karjusepirukas')
    expect(et.indexOf('LOCALE:')).toBeLessThan(et.indexOf('ESTONIAN VOICE'))

    expect(buildRecipeExtractionPrompt('test', 4)).not.toContain('ESTONIAN VOICE')
    expect(buildRecipeExtractionPrompt('test', 4, 'en')).not.toContain('ESTONIAN VOICE')
  })
})

describe('buildRecipeRequest', () => {
  const photo = (byte: string) => ({
    base64: Buffer.from(byte).toString('base64'),
    mimeType: 'image/jpeg',
  })

  it('sends one text prompt and no messages without images', () => {
    const request = buildRecipeRequest('Soup\n- 1 carrot', 4, 'en')
    expect(request).not.toHaveProperty('messages')
    expect(request).toHaveProperty('prompt')
    const prompt = (request as { prompt: string }).prompt
    expect(prompt).toContain('Extract structured data from the following recipe text.')
    expect(prompt).toContain('RECIPE TEXT:\nSoup\n- 1 carrot\n\nRECIPE CONFIDENCE SCORING')
    expect(prompt).not.toContain('RECIPE PHOTOS')
  })

  it("puts the household's size into the schema's servings default (HON-1363)", () => {
    const { schema } = buildRecipeRequest('Soup', 3, 'en', [photo('a')])
    expect(schema.shape.servings.description).toBe(
      'Number of servings the recipe makes (integer, 1-50, default to 3 if not specified)',
    )
  })

  it('treats an empty image list as no images', () => {
    expect(withJsonSchema(buildRecipeRequest('Soup', 4, 'en', []))).toEqual(
      withJsonSchema(buildRecipeRequest('Soup', 4, 'en')),
    )
  })

  it('sends one image part per photo, then the copy instruction as one text part', () => {
    const request = buildRecipeRequest('Grandma soup', 4, 'et', [photo('a'), photo('b')])
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
    const request = buildRecipeRequest('', 4, 'en', [photo('a')])
    const { messages } = request as Extract<typeof request, { messages: unknown }>
    const text = (messages[0]!.content.at(-1) as { text: string }).text
    expect(text).toContain('RECIPE PHOTOS:')
    expect(text).not.toContain('TEXT FROM THE USER')
  })
})
