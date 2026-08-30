import { VAGUE_PHRASES } from '@/lib/vague-quantities'
import { localeInstruction } from './prompts'

/**
 * Build the prompt for recipe extraction.
 *
 * `locale` is the household's locale — the parser detects the input language
 * and produces output in `locale` regardless (so Estonian input in an English
 * household comes out English, and English input in an Estonian household
 * comes out Estonian). Ingredient names stay lowercase singular base form for
 * matcher reliability; `@/lib/i18n/content#translateIngredient` handles display.
 */
export function buildRecipeExtractionPrompt(recipeText: string, locale?: string): string {
  const vaguePhrasesList = VAGUE_PHRASES.join(', ')

  return `You are a recipe parsing assistant. Extract structured data from the following recipe text.

IMPORTANT GUIDELINES:
1. Extract the recipe name, description, cooking time, servings, ingredients, and preparation steps
2. For ingredients, extract the quantity, unit, and ingredient name separately
3. Use these units: "g" for weight, "ml" for volume, "piece" for countable items, or keep original units ("cup", "tbsp", "tsp", "oz", "lb") if conversion would be inaccurate

INGREDIENT NAME SPECIFICITY (CRITICAL):
Use specific ingredient names when the database has them. Keep generic names when that's what the database stores.

| Ambiguous Text | Correct Output | Rationale |
|----------------|----------------|-----------|
| "salt and pepper to taste" | "black pepper" | DB has "black pepper" (specific) |
| "1 red pepper, diced" | "red bell pepper" | DB has "red bell pepper" (specific) |
| "sauté the onion" | "onion" | DB has "onion" (generic) |
| "add the oil" | "vegetable oil" | DB has "vegetable oil" (specific) |
| "1 cup milk" | "milk" | DB has "milk" (generic) |
| "butter for greasing" | "butter" | DB has "butter" (generic) |
| "1 cup rice" | "white rice" | DB has "white rice" (specific) |
| "a splash of vinegar" | "vinegar" | DB has "vinegar" (generic) |
| "top with cream" | "heavy cream" | DB has "heavy cream" (specific) |
| "2 tbsp extra virgin olive oil" | "olive oil" | DB has "olive oil" (strip quality grade) |
| "1 tbsp virgin olive oil" | "olive oil" | DB has "olive oil" (strip quality grade) |
| "light olive oil" | "olive oil" | DB has "olive oil" (strip quality grade) |
| "2 cans peeled tomatoes" | "canned whole peeled tomatoes" | DB has "canned whole peeled tomatoes" (specific) |
| "1 can whole tomatoes" | "canned whole peeled tomatoes" | DB has "canned whole peeled tomatoes" (specific) |
| "1 can diced tomatoes" | "canned diced tomatoes" | DB has "canned diced tomatoes" (specific) |
| "1 can chopped tomatoes" | "canned diced tomatoes" | DB has "canned diced tomatoes" (specific) |

QUALITY/PROCESSING QUALIFIERS TO STRIP:
Some ingredients have quality grades or processing descriptors that should be stripped because the DB stores only the base ingredient:
- Olive oil: "extra virgin", "virgin", "light", "pure", "cold pressed" → output "olive oil"
- These describe quality grades, not different products

Expand generic terms ONLY when the database has the specific variant (pepper → black pepper, rice → white rice, oil → vegetable oil, cream → heavy cream).
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
  Example: "2 cans peeled tomatoes" → quantity: 800, unit: "g", name: "canned whole peeled tomatoes"
  Example: "1 can diced tomatoes" → quantity: 400, unit: "g", name: "canned diced tomatoes"
  Example: "1 can coconut milk" → quantity: 400, unit: "g", name: "coconut milk"
- For herbs/leaves measured in cups, convert to grams (1 cup fresh herbs ≈ 20-30g)
  Example: "2 cups basil leaves" → quantity: 50, unit: "g", name: "basil"
- For liquids in cups, keep as cups OR convert (1 cup liquid = 240ml)
- For weight measurements, always use grams: 1 oz = 28g, 1 lb = 454g
- For small measurements: 1 tbsp = 15g, 1 tsp = 5g

SANITY CHECKS - Typical per-serving quantities:
- Herbs/spices: 5-20g per serving
- Garlic: 1-3 cloves (5-15g) per serving
- Main protein: 100-200g per serving
- Vegetables: 50-150g per serving
- Grains/pasta: 75-125g (dry) per serving
If your calculated quantities exceed these by 5x+, you likely made a conversion error.

4. Determine meal types based on the recipe content (breakfast items like eggs/pancakes, lunch/dinner for mains)
5. Mark as kid-friendly if: no spicy ingredients, familiar foods, mild flavors
6. If servings aren't specified, default to 4
7. If cooking time isn't specified, leave it as null

PREPARATION NOTES (IMPORTANT — always attempt extraction):
Extract cooking/preparation steps from the recipe text into the preparationNotes field.
- Look for ANY instructions, directions, method, or steps — even if they appear as prose rather than a numbered list
- Distill them into clean, numbered steps (e.g., "1. Preheat oven to 200°C\n2. Mix flour and salt...")
- Strip noise: blog content, personal stories, ads, navigation text, "jump to recipe" links
- Focus on actionable cooking instructions only
- If the source genuinely has no preparation steps at all, set preparationNotes to null — do NOT fabricate steps

RECIPE TEXT:
${recipeText}

RECIPE CONFIDENCE SCORING:
Rate your confidence (0-100) that this text contains a real recipe:
- 90-100: Structured recipe with clear name, ingredients list, and quantities
- 70-89: Recognizable recipe but informal format or missing some details
- 50-69: Might be a recipe but very incomplete or ambiguous
- 20-49: Unlikely to be a recipe (food-related article, general food discussion)
- 0-19: Definitely not a recipe (random text, code, news, lorem ipsum)
Be honest — if the text is not a recipe, give a low score even if you can extract something.

Extract the structured recipe data.${localeInstruction(locale)}`
}
