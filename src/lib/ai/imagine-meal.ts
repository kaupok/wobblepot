import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'
import { serverEnv } from '@/lib/env'
import { IMAGINE_MODEL } from './models'

/**
 * Schema for a single ingredient in an imagined meal.
 * Matches ExtractedIngredientSchema from parse-recipe.ts.
 *
 * NOTE: Anthropic's structured output API has limited JSON Schema support.
 * Avoid .positive(), .min(), .max(), .int() on numbers.
 * Encode constraints in .describe() instead.
 */
const ImaginedIngredientSchema = z.object({
  name: z.string().describe('The ingredient name without quantity (e.g., "chicken breast")'),
  quantity: z
    .number()
    .nullable()
    .describe('The numeric quantity (must be > 0), or null if vague (e.g., "to taste")'),
  unit: z
    .enum(['g', 'piece', 'ml', 'tbsp', 'tsp', 'cup', 'oz', 'lb'])
    .nullable()
    .describe('The unit of measurement, or null if vague'),
  originalText: z.string().describe('A human-readable description like "500g chicken breast"'),
  isVague: z.boolean().describe('True if quantity is vague (e.g., "to taste", "a pinch")'),
  vaguePhrase: z
    .string()
    .nullable()
    .describe('The vague phrase if isVague is true (e.g., "to taste", "a pinch")'),
  isDried: z
    .boolean()
    .nullable()
    .describe('For herbs, whether the ingredient is dried (e.g., "dried basil")'),
})

const ImaginedMealSchema = z.object({
  name: z.string().describe('A descriptive meal name (1-200 chars)'),
  description: z
    .string()
    .nullable()
    .describe('A brief appetizing description of the dish (max 500 chars)'),
  timeMinutes: z
    .number()
    .nullable()
    .describe('Estimated total prep + cook time in minutes (integer, 1-480)'),
  servings: z.number().describe('Number of servings (integer, 1-50)'),
  mealTypes: z
    .array(z.enum(['breakfast', 'lunch', 'dinner']))
    .describe('Which meal types this is suitable for (at least one)'),
  kidFriendly: z.boolean().describe('Whether this meal is likely kid-friendly'),
  ingredients: z
    .array(ImaginedIngredientSchema)
    .describe('The list of ingredients with quantities (at least 2)'),
})

export const ImaginedMealsSchema = z.object({
  meals: z.array(ImaginedMealSchema).describe('Exactly 3 distinct meal options'),
})

export type ImaginedMeal = z.infer<typeof ImaginedMealSchema>
export type ImaginedIngredient = z.infer<typeof ImaginedIngredientSchema>

interface HouseholdContext {
  allergens: string[]
  dietaryType: string | null
  excludedIngredients: string[]
  restrictions: string[]
  householdSize: number
}

export async function imagineMeals(
  prompt: string | null,
  household: HouseholdContext,
  images?: { base64: string; mimeType: string }[],
): Promise<ImaginedMeal[]> {
  const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })

  const constraintParts: string[] = []

  if (household.dietaryType) {
    constraintParts.push(`- Dietary type: ${household.dietaryType}`)
  }
  if (household.allergens.length > 0) {
    constraintParts.push(
      `- MUST AVOID these allergens (safety-critical): ${household.allergens.join(', ')}`,
    )
  }
  if (household.excludedIngredients.length > 0) {
    constraintParts.push(
      `- Excluded ingredients (do not use): ${household.excludedIngredients.join(', ')}`,
    )
  }
  if (household.restrictions.length > 0) {
    constraintParts.push(`- Dietary preferences: ${household.restrictions.join(', ')}`)
  }

  const constraintsSection =
    constraintParts.length > 0
      ? `\n\nHousehold dietary constraints:\n${constraintParts.join('\n')}`
      : ''

  const systemPrompt = `You are a creative home cooking assistant. Generate exactly 3 distinct meal ideas based on the user's description. Each meal should be different from the others — vary the cooking method, cuisine style, or primary ingredients.

Guidelines:
- Generate meals for a household of ${household.householdSize} people. Each meal should make ${household.householdSize} servings.
- Use simple, commonly available ingredients (nothing exotic or hard to find)
- Be creative but practical — these are everyday family meals
- Include a mix of proteins, vegetables, and carbs where appropriate
- Estimate realistic prep + cook times
- Each meal should have at least 3-4 ingredients for a complete dish

Ingredient naming rules (IMPORTANT — names are matched against a database):
- Use singular form: "egg" not "eggs", "tomato" not "tomatoes", "carrot" not "carrots"
- Use simple base names without cooking adjectives: "chives" not "fresh chives", "bread" not "black bread"
- Do NOT prefix with preparation words like fresh, dried, sliced, chopped, minced, frozen, canned, etc.
- Specificity is OK when it's part of the ingredient identity: "chicken breast", "olive oil", "sour cream"

Quantity guidelines (per serving, scale by number of servings):
- Proteins (meat, fish, tofu): 100-200g per serving
- Main vegetables (core to the dish): 80-150g per serving
- Grains/pasta (dry weight): 75-100g per serving
- Rice (dry weight): 65-80g per serving
- Cooking oils/fats: 1-2 tbsp total (not per serving)
- Fresh herbs: 5-15g total
- Dried herbs/spices: 0.5-2 tsp each
- Garlic: 1-2 cloves per serving
- Onion: roughly 0.5 medium onion per serving
- Sauces/condiments: 1-2 tbsp per serving
- Cheese: 20-40g per serving

Important: quantities must reflect the ingredient's role in the dish. A main-component vegetable (e.g., bell pepper in a stir-fry) needs 80-150g/serving, while a garnish or accent (e.g., a few slices of bell pepper on a sandwich) needs only 20-30g/serving.

BAD: "30g red bell pepper" for 4 servings of roasted vegetables (7.5g/serving — barely a slice)
GOOD: "400g red bell pepper" for 4 servings of roasted vegetables (100g/serving)

The user may attach photos for context — these could show ingredients they have available, a dish they'd like to recreate, a recipe from a cookbook, or anything else. Use the visual information to inform your meal suggestions. If the photos show specific ingredients, try to incorporate them. If they show a prepared dish or recipe page, use it as inspiration for one or more of your suggestions.${constraintsSection}`

  const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: Buffer }> = []

  if (images?.length) {
    for (const img of images) {
      content.push({
        type: 'image',
        image: Buffer.from(img.base64, 'base64'),
      })
    }
  }

  const textPrompt = prompt
    ? `Generate 3 meal ideas based on this description: "${prompt}"`
    : 'Generate 3 meal ideas inspired by the attached photo(s).'

  content.push({ type: 'text', text: textPrompt })

  const result = await generateObject({
    model: anthropic(IMAGINE_MODEL),
    schema: ImaginedMealsSchema,
    messages: [{ role: 'user' as const, content }],
    system: systemPrompt,
  })

  return result.object.meals
}
