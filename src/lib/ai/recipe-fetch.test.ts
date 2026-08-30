import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCheckRobotsAllowed = vi.fn()
vi.mock('@/lib/robots', () => ({
  WOBBLEPOT_BOT_USER_AGENT: 'Wobblepot-Bot/1.0 (+https://wobblepot.com/bot)',
  WOBBLEPOT_BOT_TOKEN: 'Wobblepot-Bot/1.0',
  checkRobotsAllowed: (url: string) => mockCheckRobotsAllowed(url),
}))

import {
  stripHtmlToText,
  extractJsonLdRecipe,
  fetchRecipeFromUrl,
  ROBOTS_DISALLOWED_MESSAGE,
} from './recipe-fetch'
import { RecipeParseError } from './recipe-errors'

describe('stripHtmlToText', () => {
  it('strips HTML tags', () => {
    expect(stripHtmlToText('<p>Hello <b>world</b></p>')).toBe('Hello world')
  })

  it('removes script and style blocks', () => {
    const html = '<p>Recipe</p><script>alert("x")</script><style>.a{}</style><p>Ingredients</p>'
    expect(stripHtmlToText(html)).toBe('Recipe Ingredients')
  })

  it('removes nav, header, and footer blocks', () => {
    const html = '<header>Nav bar</header><main>Recipe content</main><footer>Copyright</footer>'
    expect(stripHtmlToText(html)).toBe('Recipe content')
  })

  it('decodes HTML entities', () => {
    expect(stripHtmlToText('&amp; &lt; &gt; &quot; &#039; &apos; &nbsp;')).toBe("& < > \" ' '")
  })

  it('collapses whitespace', () => {
    expect(stripHtmlToText('  hello   world  \n\n  foo  ')).toBe('hello world foo')
  })

  it('handles empty input', () => {
    expect(stripHtmlToText('')).toBe('')
  })
})

describe('extractJsonLdRecipe', () => {
  it('extracts recipe from top-level JSON-LD object', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Recipe",
        "name": "Classic Beef Stroganoff",
        "description": "A creamy beef dish",
        "prepTime": "PT15M",
        "cookTime": "PT30M",
        "recipeYield": "4 servings",
        "recipeIngredient": [
          "500g beef sirloin",
          "200g mushrooms",
          "1 cup sour cream"
        ],
        "recipeInstructions": [
          {"@type": "HowToStep", "text": "Slice the beef thinly."},
          {"@type": "HowToStep", "text": "Sauté mushrooms until golden."},
          {"@type": "HowToStep", "text": "Combine with sour cream sauce."}
        ]
      }
      </script>
    </head><body></body></html>`

    const result = extractJsonLdRecipe(html)
    expect(result).not.toBeNull()
    expect(result).toContain('Classic Beef Stroganoff')
    expect(result).toContain('500g beef sirloin')
    expect(result).toContain('200g mushrooms')
    expect(result).toContain('1 cup sour cream')
    expect(result).toContain('Prep: 15 min')
    expect(result).toContain('Cook: 30 min')
    expect(result).toContain('Servings: 4 servings')
    expect(result).toContain('Slice the beef thinly')
  })

  it('extracts recipe from @graph array', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@graph": [
          {"@type": "WebSite", "name": "My Recipes"},
          {
            "@type": "Recipe",
            "name": "Easy Chicken Fajitas",
            "recipeIngredient": ["500g chicken breast", "2 bell peppers"],
            "recipeInstructions": [
              {"@type": "HowToStep", "text": "Slice chicken and peppers."}
            ]
          }
        ]
      }
      </script>
    </head><body></body></html>`

    const result = extractJsonLdRecipe(html)
    expect(result).not.toBeNull()
    expect(result).toContain('Easy Chicken Fajitas')
    expect(result).toContain('500g chicken breast')
    expect(result).toContain('2 bell peppers')
  })

  it('handles @type as array (e.g., ["Recipe", "HowTo"])', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@type": ["Recipe", "HowTo"],
        "name": "Pizza Dough",
        "recipeIngredient": ["500g flour", "7g yeast"]
      }
      </script>
    </head><body></body></html>`

    const result = extractJsonLdRecipe(html)
    expect(result).not.toBeNull()
    expect(result).toContain('Pizza Dough')
    expect(result).toContain('500g flour')
  })

  it('handles string instructions', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Simple Soup",
        "recipeIngredient": ["1 onion", "2 carrots", "500ml stock"],
        "recipeInstructions": "Chop vegetables. Add to stock. Simmer for 30 minutes."
      }
      </script>
    </head><body></body></html>`

    const result = extractJsonLdRecipe(html)
    expect(result).not.toBeNull()
    expect(result).toContain('Simple Soup')
    expect(result).toContain('Chop vegetables')
  })

  it('handles string array instructions', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Quick Pasta",
        "recipeIngredient": ["400g pasta"],
        "recipeInstructions": ["Boil water.", "Cook pasta 8 min.", "Drain and serve."]
      }
      </script>
    </head><body></body></html>`

    const result = extractJsonLdRecipe(html)
    expect(result).not.toBeNull()
    expect(result).toContain('1. Boil water.')
    expect(result).toContain('2. Cook pasta 8 min.')
    expect(result).toContain('3. Drain and serve.')
  })

  it('returns null when no JSON-LD scripts found', () => {
    const html = '<html><head></head><body><h1>Recipe</h1></body></html>'
    expect(extractJsonLdRecipe(html)).toBeNull()
  })

  it('returns null when JSON-LD has no Recipe type', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {"@type": "WebSite", "name": "My Blog"}
      </script>
    </head><body></body></html>`

    expect(extractJsonLdRecipe(html)).toBeNull()
  })

  it('returns null when JSON-LD is invalid JSON', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {invalid json here}
      </script>
    </head><body></body></html>`

    expect(extractJsonLdRecipe(html)).toBeNull()
  })

  it('handles recipe with missing optional fields', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Minimal Recipe",
        "recipeIngredient": ["100g butter", "200g sugar"]
      }
      </script>
    </head><body></body></html>`

    const result = extractJsonLdRecipe(html)
    expect(result).not.toBeNull()
    expect(result).toContain('Minimal Recipe')
    expect(result).toContain('100g butter')
    expect(result).not.toContain('Time:')
    expect(result).not.toContain('Instructions:')
  })

  it('handles totalTime without prep/cook breakdown', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Quick Dish",
        "totalTime": "PT1H15M",
        "recipeIngredient": ["200g rice"]
      }
      </script>
    </head><body></body></html>`

    const result = extractJsonLdRecipe(html)
    expect(result).not.toBeNull()
    expect(result).toContain('Total: 75 min')
  })

  it('handles recipeYield as array', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Batch Recipe",
        "recipeYield": ["8", "8 servings"],
        "recipeIngredient": ["1kg flour"]
      }
      </script>
    </head><body></body></html>`

    const result = extractJsonLdRecipe(html)
    expect(result).not.toBeNull()
    expect(result).toContain('Servings: 8')
  })

  it('skips non-Recipe JSON-LD and finds Recipe in later script', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {"@type": "WebSite", "name": "Blog"}
      </script>
      <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Found Recipe With Enough Content",
        "recipeIngredient": ["3 eggs", "200g flour", "100ml milk"]
      }
      </script>
    </head><body></body></html>`

    const result = extractJsonLdRecipe(html)
    expect(result).not.toBeNull()
    expect(result).toContain('Found Recipe With Enough Content')
  })

  it('returns null for recipe with too little content', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "X"
      }
      </script>
    </head><body></body></html>`

    // Name is "X" with no ingredients — formatted text will be < 50 chars
    expect(extractJsonLdRecipe(html)).toBeNull()
  })

  it('extracts instructions from HowToSection with nested HowToStep', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Homemade Pizza",
        "recipeIngredient": ["500g flour", "7g yeast", "300ml water"],
        "recipeInstructions": [
          {
            "@type": "HowToSection",
            "name": "Make the dough",
            "itemListElement": [
              {"@type": "HowToStep", "text": "Mix flour, yeast, and water."},
              {"@type": "HowToStep", "text": "Knead for 10 minutes."}
            ]
          },
          {
            "@type": "HowToSection",
            "name": "Bake the pizza",
            "itemListElement": [
              {"@type": "HowToStep", "text": "Preheat oven to 250°C."},
              {"@type": "HowToStep", "text": "Roll out dough and add toppings."},
              {"@type": "HowToStep", "text": "Bake for 12-15 minutes."}
            ]
          }
        ]
      }
      </script>
    </head><body></body></html>`

    const result = extractJsonLdRecipe(html)
    expect(result).not.toBeNull()
    expect(result).toContain('1. Mix flour, yeast, and water.')
    expect(result).toContain('2. Knead for 10 minutes.')
    expect(result).toContain('3. Preheat oven to 250°C.')
    expect(result).toContain('4. Roll out dough and add toppings.')
    expect(result).toContain('5. Bake for 12-15 minutes.')
  })

  it('handles mixed HowToSection and HowToStep instructions', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "Mixed Format Recipe",
        "recipeIngredient": ["200g pasta", "100g cheese"],
        "recipeInstructions": [
          {"@type": "HowToStep", "text": "Boil water."},
          {
            "@type": "HowToSection",
            "name": "Make the sauce",
            "itemListElement": [
              {"@type": "HowToStep", "text": "Melt butter in a pan."},
              {"@type": "HowToStep", "text": "Add cheese and stir."}
            ]
          },
          {"@type": "HowToStep", "text": "Combine and serve."}
        ]
      }
      </script>
    </head><body></body></html>`

    const result = extractJsonLdRecipe(html)
    expect(result).not.toBeNull()
    expect(result).toContain('1. Boil water.')
    expect(result).toContain('2. Melt butter in a pan.')
    expect(result).toContain('3. Add cheese and stir.')
    expect(result).toContain('4. Combine and serve.')
  })
})

describe('fetchRecipeFromUrl', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockCheckRobotsAllowed.mockReset().mockResolvedValue(true)
  })

  it('blocks localhost URLs', async () => {
    await expect(fetchRecipeFromUrl('https://localhost/recipe')).rejects.toThrow(
      'Cannot fetch from private or local addresses',
    )
  })

  it('blocks private IP addresses', async () => {
    await expect(fetchRecipeFromUrl('https://192.168.1.1/recipe')).rejects.toThrow(
      'Cannot fetch from private or local addresses',
    )
    await expect(fetchRecipeFromUrl('https://10.0.0.1/recipe')).rejects.toThrow(
      'Cannot fetch from private or local addresses',
    )
    await expect(fetchRecipeFromUrl('https://172.16.0.1/recipe')).rejects.toThrow(
      'Cannot fetch from private or local addresses',
    )
  })

  it('throws RecipeParseError on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not Found', { status: 404, headers: { 'content-type': 'text/html' } }),
    )

    await expect(fetchRecipeFromUrl('https://example.com/recipe')).rejects.toThrow(RecipeParseError)
    await expect(fetchRecipeFromUrl('https://example.com/recipe')).rejects.toThrow(
      "We couldn't import from that URL",
    )
  })

  it('throws RecipeParseError for non-HTML content type', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    await expect(fetchRecipeFromUrl('https://example.com/recipe')).rejects.toThrow(
      'does not point to a web page',
    )
  })

  it('throws RecipeParseError when extracted text is too short', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><body>Hi</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )

    await expect(fetchRecipeFromUrl('https://example.com/recipe')).rejects.toThrow(
      'Could not extract enough content',
    )
  })

  it('returns stripped text content on success', async () => {
    const html = `<html><body>
      <h1>Chicken Stir Fry</h1>
      <p>Serves 4. A delicious quick weeknight dinner with fresh vegetables and tender chicken.</p>
      <ul><li>500g chicken breast</li><li>2 tbsp soy sauce</li></ul>
    </body></html>`

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
    )

    const result = await fetchRecipeFromUrl('https://example.com/recipe')
    expect(result).toContain('Chicken Stir Fry')
    expect(result).toContain('500g chicken breast')
    expect(result).not.toContain('<')
  })

  it('throws RecipeParseError on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))

    await expect(fetchRecipeFromUrl('https://example.com/recipe')).rejects.toThrow(RecipeParseError)
    await expect(fetchRecipeFromUrl('https://example.com/recipe')).rejects.toThrow(
      "We couldn't import from that URL",
    )
  })

  it('uses the Wobblepot-Bot User-Agent', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        '<html><body><p>Some recipe content that is long enough to pass the check</p></body></html>',
        {
          status: 200,
          headers: { 'content-type': 'text/html' },
        },
      ),
    )

    await fetchRecipeFromUrl('https://example.com/recipe')

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/recipe',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': 'Wobblepot-Bot/1.0 (+https://wobblepot.com/bot)',
        }),
      }),
    )
  })

  it('throws ROBOTS_DISALLOWED_MESSAGE and skips the page fetch when robots.txt disallows the URL', async () => {
    mockCheckRobotsAllowed.mockResolvedValue(false)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(fetchRecipeFromUrl('https://example.com/recipe')).rejects.toThrow(RecipeParseError)
    await expect(fetchRecipeFromUrl('https://example.com/recipe')).rejects.toThrow(
      ROBOTS_DISALLOWED_MESSAGE,
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns JSON-LD recipe text when available', async () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@type": "Recipe",
        "name": "JSON-LD Chicken Curry",
        "recipeIngredient": ["500g chicken", "200ml coconut milk", "2 tbsp curry paste"],
        "recipeInstructions": [{"@type": "HowToStep", "text": "Cook chicken with curry paste."}]
      }
      </script>
    </head><body><p>Lots of blog noise and ads here...</p></body></html>`

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
    )

    const result = await fetchRecipeFromUrl('https://example.com/recipe')
    expect(result).toContain('JSON-LD Chicken Curry')
    expect(result).toContain('500g chicken')
    expect(result).not.toContain('blog noise')
  })

  it('truncates stripped HTML to 10k characters when no JSON-LD', async () => {
    // Create HTML that produces text > 10k characters
    const longContent = 'A'.repeat(15000)
    const html = `<html><body><p>${longContent}</p></body></html>`

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
    )

    const result = await fetchRecipeFromUrl('https://example.com/recipe')
    expect(result.length).toBeLessThanOrEqual(10000)
  })
})
