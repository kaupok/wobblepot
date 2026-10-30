import type { EncodedImage } from '@/lib/image-attachments-server'
import { VAGUE_PHRASES } from '@/lib/vague-quantities'

import { britishEnglish, estonianVoiceForRecipeParse, localeInstruction } from './prompts'
import { buildRecipeExtractionSchema } from './recipe-schema'

/**
 * Build the prompt for recipe extraction.
 *
 * `locale` is the household's locale — the parser detects the input language
 * and produces output in `locale` regardless (so Estonian input in an English
 * household comes out English, and English input in an Estonian household
 * comes out Estonian). Ingredient names stay lowercase singular base form for
 * matcher reliability; `@/lib/i18n/content#translateIngredient` handles display.
 *
 * `defaultServings` is the household's member count: a recipe that does not
 * say how many it serves gets it, as the blank recipe form does (HON-1363).
 */
export function buildRecipeExtractionPrompt(
  recipeText: string,
  defaultServings: number,
  locale?: string,
  fromPhotos = false,
): string {
  const vaguePhrasesList = VAGUE_PHRASES.join(', ')
  const source = fromPhotos
    ? 'the recipe shown in the attached photos'
    : 'the following recipe text'

  return `You are a recipe parsing assistant. Extract structured data from ${source}.

IMPORTANT GUIDELINES:
1. Extract the recipe name, description, cooking time, servings, ingredients, and preparation steps
2. For ingredients, extract the quantity, unit, and ingredient name separately
3. Use these units: "g" for weight, "ml" for volume, "piece" for countable items, or keep original units ("cup", "tbsp", "tsp", "oz", "lb") if conversion would be inaccurate

INGREDIENT NAME SPECIFICITY (CRITICAL):
Use specific ingredient names when the database has them. Keep generic names when that's what the database stores.

| Ambiguous Text | Correct Output | Rationale |
|----------------|----------------|-----------|
| "salt and pepper to taste" | "black pepper" | DB has "black pepper" (specific) |
| "1 red bell pepper, diced" | "red pepper" | DB has "red pepper" (specific) |
| "sauté the onion" | "onion" | DB has "onion" (generic) |
| "add the oil" | "vegetable oil" | DB has "vegetable oil" (specific) |
| "1 cup milk" | "milk" | DB has "milk" (generic) |
| "butter for greasing" | "butter" | DB has "butter" (generic) |
| "1 cup rice" | "white rice" | DB has "white rice" (specific) |
| "a splash of vinegar" | "vinegar" | DB has "vinegar" (generic) |
| "top with cream" | "double cream" | DB has "double cream" (specific) |
| "2 tbsp extra virgin olive oil" | "olive oil" | DB has "olive oil" (strip quality grade) |
| "1 tbsp virgin olive oil" | "olive oil" | DB has "olive oil" (strip quality grade) |
| "light olive oil" | "olive oil" | DB has "olive oil" (strip quality grade) |
| "2 cans peeled tomatoes" | "tinned plum tomatoes" | DB has "tinned plum tomatoes" (specific) |
| "1 can whole tomatoes" | "tinned plum tomatoes" | DB has "tinned plum tomatoes" (specific) |
| "1 can diced tomatoes" | "tinned chopped tomatoes" | DB has "tinned chopped tomatoes" (specific) |
| "1 can chopped tomatoes" | "tinned chopped tomatoes" | DB has "tinned chopped tomatoes" (specific) |

QUALITY/PROCESSING QUALIFIERS TO STRIP:
Some ingredients have quality grades or processing descriptors that should be stripped because the DB stores only the base ingredient:
- Olive oil: "extra virgin", "virgin", "light", "pure", "cold pressed" → output "olive oil"
- These describe quality grades, not different products

MEAT AND FISH CUTS:
Keep the form the recipe states. The DB has a bone-in or whole row and a boneless "<cut> fillet" row, and the bone changes the nutrition:
- "boneless", "fillet" or "meat" means the boneless row: "boneless skinless chicken thighs" → "chicken thigh fillet", "chicken thigh meat" → "chicken thigh fillet", "trout fillets" → "trout fillet"
- A bone-in cut or a whole fish keeps the bare name: "bone-in chicken thighs" → "chicken thigh", "whole trout" → "trout"
- A cut given in pieces is weighed: a bone-in cut with the bone, a boneless cut without it. "4 chicken thighs" → quantity: 600, unit: "g", name: "chicken thigh"; "4 boneless chicken thighs" → quantity: 400, unit: "g", name: "chicken thigh fillet"

Expand generic terms ONLY when the database has the specific variant (pepper → black pepper, rice → white rice, oil → vegetable oil, cream → double cream).
Keep generic terms when that's what the database stores (onion, milk, butter, vinegar, olive oil).

VAGUE QUANTITY DETECTION:
Some ingredients have imprecise quantities. Detect these vague phrases:
${vaguePhrasesList}

When you detect a vague phrase:
- Set isVague: true
- Set vaguePhrase to the detected phrase (e.g., "to taste", "a pinch")
- Set quantity: null and unit: null
- Keep the ingredient name clean (without the vague phrase)

Examples:
- "salt to taste" → name: "salt", isVague: true, vaguePhrase: "to taste", quantity: null, unit: null
- "a pinch of paprika" → name: "paprika", isVague: true, vaguePhrase: "a pinch", quantity: null, unit: null
- "fresh parsley for garnish" → name: "parsley", isVague: true, vaguePhrase: "for garnish", quantity: null, unit: null
- "dried basil (optional)" → name: "basil", isVague: true, vaguePhrase: "optional", quantity: null, unit: null, isDried: true

DRIED HERBS:
If an herb is explicitly "dried" (e.g., "dried oregano", "1 tsp dried basil"), set isDried: true.
If not specified or clearly fresh (e.g., "fresh basil", "basil leaves"), set isDried: false or null.

CRITICAL QUANTITY RULES (for non-vague ingredients):
- For countable items (eggs, garlic cloves, chicken breasts, onions), use "piece" as unit with the COUNT as quantity
  Example: "4 cloves garlic" → quantity: 4, unit: "piece", name: "garlic"
  Example: "2 chicken breasts" → quantity: 2, unit: "piece", name: "chicken breast"
- For canned items: "can" is NOT a supported unit. Convert to grams: 1 standard can ≈ 400g
  Example: "2 cans peeled tomatoes" → quantity: 800, unit: "g", name: "tinned plum tomatoes"
  Example: "1 can diced tomatoes" → quantity: 400, unit: "g", name: "tinned chopped tomatoes"
  Example: "1 can coconut milk" → quantity: 400, unit: "g", name: "coconut milk"
- For herbs/leaves measured in cups, convert to grams (1 cup fresh herbs ≈ 20-30g)
  Example: "2 cups basil leaves" → quantity: 50, unit: "g", name: "basil"
- For liquids in cups, keep as cups OR convert (1 cup liquid = 240ml)
- For weight measurements, always use grams: 1 oz = 28g, 1 lb = 454g
- For small measurements: 1 tbsp = 15g, 1 tsp = 5g
- Give every weight as bought: dry rice, pasta, grains and lentils, drained canned beans, bone-in cuts and whole fish with the bone. Ingredient nutrition is for that form
  If the recipe gives a cooked weight, convert it to dry: cooked rice, grains or lentils × 0.4, cooked pasta or noodles × 0.45
  Example: "500g cooked rice" → quantity: 200, unit: "g", name: "white rice"

SANITY CHECKS - Typical per-serving quantities:
- Herbs/spices: 5-20g per serving
- Garlic: 1-3 cloves (5-15g) per serving
- Main protein: 100-200g per serving boneless, 250-400g bone-in or whole
- Vegetables: 50-150g per serving
- Grains/pasta: 75-125g (dry) per serving
If your calculated quantities exceed these by 5x+, you likely made a conversion error.

4. Determine meal types based on the recipe content (breakfast items like eggs/pancakes, lunch/dinner for mains)
5. Mark as kid-friendly if: no spicy ingredients, familiar foods, mild flavors
6. If servings aren't specified, default to ${defaultServings}
7. If cooking time isn't specified, leave it as null

PREPARATION NOTES (IMPORTANT — always attempt extraction):
Extract cooking/preparation steps from the recipe text into the preparationNotes field.
- Look for ANY instructions, directions, method, or steps — even if they appear as prose rather than a numbered list
- Distill them into clean, numbered steps (e.g., "1. Preheat oven to 200°C\n2. Mix flour and salt...")
- Strip noise: blog content, personal stories, ads, navigation text, "jump to recipe" links
- Focus on actionable cooking instructions only
- If the source genuinely has no preparation steps at all, set preparationNotes to null — do NOT fabricate steps

${fromPhotos ? photoSection(recipeText) : `RECIPE TEXT:\n${recipeText}`}

RECIPE CONFIDENCE SCORING:
Rate your confidence (0-100) that ${fromPhotos ? 'the photos show' : 'this text contains'} a real recipe:
- 90-100: Structured recipe with clear name, ingredients list, and quantities
- 70-89: Recognizable recipe but informal format or missing some details
- 50-69: Might be a recipe but very incomplete or ambiguous
- 20-49: Unlikely to be a recipe (food-related article, general food discussion)
- 0-19: Definitely not a recipe (random text, code, news, lorem ipsum)
Be honest — if the text is not a recipe, give a low score even if you can extract something.

Extract the structured recipe data.${localeInstruction(locale)}${britishEnglish(locale)}${estonianVoiceForRecipeParse(locale)}`
}

/**
 * The photo branch of the prompt (HON-1274). The photos are a recipe the
 * family already cooks, so the model copies it: unlike Imagine, which uses a
 * photo as inspiration, it must not invent or add anything.
 */
function photoSection(recipeText: string): string {
  const context = recipeText ? `\n\nTEXT FROM THE USER (extra context only):\n${recipeText}` : ''
  return `RECIPE PHOTOS:
- Copy the recipe shown in the photos. Do not invent a recipe, and do not add ingredients, quantities or steps that the photos do not show
- Several photos can be pages of one recipe. Combine them into one recipe
- The photos can be a cookbook page, a handwritten card or a screenshot, in any language
- If the photos show a dish, food or anything else but no written recipe, there is no recipe to copy: return an empty ingredients list and give a confidence below 20. Do not guess ingredients from how a dish looks${context}`
}

/**
 * Every `generateObject` argument recipe parsing sends except `model` and
 * `abortSignal`. Pure, so the model benchmark (HON-795) sends the request
 * production sends (HON-796). `recipeText` is already trimmed; the length
 * check and every post-call check stay in `parseRecipeText`.
 *
 * Without images the request is a single `prompt`, unchanged by HON-1274.
 * With images it is one user message: an image part per photo, then the
 * prompt as one text part, the shape `buildImagineRequest` sends.
 */
export function buildRecipeRequest(
  recipeText: string,
  defaultServings: number,
  locale?: string,
  images?: EncodedImage[],
) {
  const schema = buildRecipeExtractionSchema(defaultServings)
  if (!images?.length) {
    return {
      schema,
      prompt: buildRecipeExtractionPrompt(recipeText, defaultServings, locale),
    }
  }

  const content: Array<
    { type: 'text'; text: string } | { type: 'image'; image: Buffer; mediaType: string }
  > = images.map((img) => ({
    type: 'image' as const,
    image: Buffer.from(img.base64, 'base64'),
    mediaType: img.mimeType,
  }))
  content.push({
    type: 'text',
    text: buildRecipeExtractionPrompt(recipeText, defaultServings, locale, true),
  })

  return {
    schema,
    messages: [{ role: 'user' as const, content }],
  }
}
