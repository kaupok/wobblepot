import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'
import { serverEnv } from '@/lib/env'
import { REVIEW_MODEL } from './models'
import { localeInstruction } from './prompts'
import type { AiUsageStats } from './usage'

export interface ReviewIngredient {
  ingredientId: string
  name: string
  quantityPerServing: number
  unit: 'g' | 'piece'
}

/**
 * Schema for the AI-corrected quantities response.
 *
 * NOTE: Anthropic's structured output API has limited JSON Schema support.
 * Avoid .positive(), .min(), .max(), .int() on numbers.
 * Encode constraints in .describe() instead.
 */
const ReviewedIngredientsSchema = z.object({
  ingredients: z.array(
    z.object({
      ingredientId: z.string().describe('The ingredient ID (pass through unchanged)'),
      quantityPerServing: z
        .number()
        .describe('Corrected quantity per serving (must be > 0). Use the same unit as input.'),
    }),
  ),
})

export type ReviewedIngredients = z.infer<typeof ReviewedIngredientsSchema>

export async function reviewMealQuantities(
  mealName: string,
  servings: number,
  ingredients: ReviewIngredient[],
  locale: string,
  onAiUsage?: (usage: AiUsageStats) => void,
): Promise<ReviewedIngredients> {
  const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })

  const ingredientList = ingredients
    .map(
      (ing) =>
        `- ${ing.name}: ${ing.quantityPerServing}${ing.unit}/serving (${ing.quantityPerServing * servings}${ing.unit} total for ${servings} servings) [id: ${ing.ingredientId}]`,
    )
    .join('\n')

  const systemPrompt = `You are a cooking quantity reviewer. You receive a meal with ingredient quantities and must check them for cooking realism. Return corrected quantities.

Review criteria:
- Per-serving quantities relative to the ingredient's role (main component vs garnish vs seasoning)
- Proportions between ingredients (protein-to-vegetable ratio, sauce-to-base ratio)
- Seasoning and spice amounts (should be small: 0.5-2g dried spices, 2-5g fresh herbs per serving)
- Liquid quantities for stews, soups, sauces
- Oil/fat amounts (typically 5-10ml per serving, not per ingredient)

Reference ranges (per serving):
- Main protein (meat, fish, tofu): 100-200g
- Main vegetables (core to dish): 80-150g
- Accent/garnish vegetables: 20-40g
- Grains/pasta (dry): 75-100g
- Rice (dry): 65-80g
- Cheese: 20-40g
- Cooking oil: 5-10g (often shared across servings)
- Fresh herbs: 2-5g
- Dried herbs/spices: 0.5-2g
- Garlic: 3-5g (1-2 cloves)
- Sauces/condiments: 10-20g

Rules:
- If a quantity looks reasonable, keep it unchanged
- Only correct quantities that are clearly wrong (too low or too high for the ingredient's role)
- Every ingredient in the input must appear in the output with the same ingredientId
- Quantities must be > 0
- Use realistic home cooking amounts, not restaurant portions${localeInstruction(locale)}`

  const result = await generateObject({
    model: anthropic(REVIEW_MODEL),
    schema: ReviewedIngredientsSchema,
    prompt: `Review and correct the quantities for this meal:

Meal: "${mealName}" (${servings} servings)

Ingredients:
${ingredientList}

Return all ingredients with corrected quantities per serving. Keep reasonable quantities unchanged.`,
    system: systemPrompt,
  })

  onAiUsage?.({
    model: REVIEW_MODEL,
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
  })

  return result.object
}
