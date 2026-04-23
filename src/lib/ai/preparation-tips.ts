import { z } from 'zod'
import { localeInstruction } from './prompts'

export const fullTipsSchema = z.object({
  equipment: z
    .array(z.string())
    .describe('3-5 essential equipment items (pans, bowls, utensils) specific to this meal'),
  steps: z
    .array(z.string())
    .describe(
      '4-6 ordered preparation steps covering what to start first, parallel prep, and timing tips',
    ),
  pitfalls: z.array(z.string()).describe('2-3 common mistakes to avoid with this dish'),
  tip: z.string().describe('One helpful cooking tip').optional(),
})

export const supplementaryTipsSchema = z.object({
  pitfalls: z
    .array(z.string())
    .describe('2-3 common mistakes to avoid, focusing on pitfalls not covered in the user notes'),
  tip: z.string().describe('One helpful cooking tip relevant to the user method'),
})

const metricReminder = `IMPORTANT: Use metric units for ALL measurements:
- Temperatures: °C (e.g., "190°C")
- Weights: g or kg (e.g., "500g", "1.5kg")
- Volumes: ml or L (e.g., "250ml", "1L")
- Lengths: cm (e.g., "2cm")
Never use Fahrenheit, cups, ounces, pounds, or inches.`

export interface PrepTipsPromptInput {
  mealName: string
  householdSize: number
  timeMinutes: number | null
  ingredientsList: string
  /** Household locale; threaded into the AI prompt so output fields come back in the household's language. */
  locale: string
}

export interface SupplementaryPrepTipsPromptInput extends PrepTipsPromptInput {
  preparationNotes: string
}

export function buildFullTipsPrompt(input: PrepTipsPromptInput): string {
  const { mealName, householdSize, timeMinutes, ingredientsList, locale } = input

  return `You are a helpful cooking assistant. Generate brief, actionable preparation guidance for the following meal.

Meal: ${mealName}
Servings: ${householdSize}
${timeMinutes ? `Time budget: ${timeMinutes} minutes` : ''}

Ingredients:
${ingredientsList}

Provide:
- equipment: 3-5 essential equipment items (be specific, e.g., "Large oven-safe skillet" not just "pan")
- steps: 4-6 ordered steps covering what to start first (longest cooking items), parallel prep, and timing tips
- pitfalls: 2-3 common mistakes or pitfalls specific to this dish
- tip: One helpful cooking tip

${metricReminder}

Keep it brief and practical. Not a full recipe — just order of operations and key tips. Do not repeat ingredient quantities.${localeInstruction(locale)}`
}

export function buildSupplementaryTipsPrompt(input: SupplementaryPrepTipsPromptInput): string {
  const { mealName, householdSize, timeMinutes, ingredientsList, preparationNotes, locale } = input

  return `You are a helpful cooking assistant. The user has their own preparation notes for this meal. Generate supplementary tips that ENHANCE their method — do NOT repeat what they already wrote.

Meal: ${mealName}
Servings: ${householdSize}
${timeMinutes ? `Time budget: ${timeMinutes} minutes` : ''}

Ingredients:
${ingredientsList}

User's preparation notes:
${preparationNotes}

Based on the user's method above, provide ONLY supplementary guidance:
- pitfalls: 2-3 common mistakes specific to their approach that they didn't mention
- tip: One helpful cooking tip relevant to their method

Do NOT repeat or rephrase what the user already wrote. Only add new information.

${metricReminder}

Keep it brief and practical.${localeInstruction(locale)}`
}
