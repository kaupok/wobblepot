import { z } from 'zod'
import {
  localeInstruction,
  britishEnglish,
  estonianVoiceForPrepSteps,
  englishVoiceForPrepSteps,
} from './prompts'

export const fullStepsSchema = z.object({
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

export const supplementaryStepsSchema = z.object({
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

export interface PrepStepsPromptInput {
  mealName: string
  householdSize: number
  timeMinutes: number | null
  ingredientsList: string
  /** Household locale; threaded into the AI prompt so output fields come back in the household's language. */
  locale: string
}

export interface SupplementaryPrepStepsPromptInput extends PrepStepsPromptInput {
  preparationNotes: string
}

export function buildFullStepsPrompt(input: PrepStepsPromptInput): string {
  const { mealName, householdSize, timeMinutes, ingredientsList, locale } = input

  return `You are a helpful cooking assistant. Generate brief, actionable preparation guidance for the following meal.

Meal: ${mealName}
Servings: ${householdSize}
${timeMinutes ? `Time budget: ${timeMinutes} minutes` : ''}

Ingredients:
${ingredientsList}

Provide:
- equipment: 3-5 essential equipment items (be specific, e.g., "Large oven-safe frying pan" not just "pan")
- steps: 4-6 ordered steps covering what to start first (longest cooking items), parallel prep, and timing tips
- pitfalls: 2-3 common mistakes or pitfalls specific to this dish
- tip: One helpful cooking tip

${metricReminder}

Keep it brief and practical. Not a full recipe — just order of operations and key tips. Do not repeat ingredient quantities.${localeInstruction(locale)}${britishEnglish(locale)}${estonianVoiceForPrepSteps(locale)}${englishVoiceForPrepSteps(locale)}`
}

export function buildSupplementaryStepsPrompt(input: SupplementaryPrepStepsPromptInput): string {
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

Keep it brief and practical.${localeInstruction(locale)}${britishEnglish(locale)}${estonianVoiceForPrepSteps(locale)}${englishVoiceForPrepSteps(locale)}`
}

export interface StepsComponent {
  name: string
  quantityPerServing: number
  defaultUnit: string
}

export interface StepsRequestInput {
  mealName: string
  /** The entry's effective servings; scales the ingredient quantities and the prompt's "Servings" line. */
  servings: number
  timeMinutes: number | null
  components: StepsComponent[]
  /** Household locale; threaded into the AI prompt so output fields come back in the household's language. */
  locale: string
}

export interface SupplementaryStepsRequestInput extends StepsRequestInput {
  preparationNotes: string
}

/**
 * One line per component: total quantity for `servings`, rounded, with `piece`
 * shown as `pcs`. Shared with the cook-question prompt (HON-969).
 */
export function formatIngredientsList(components: StepsComponent[], servings: number): string {
  return components
    .map((comp) => {
      const quantity = comp.quantityPerServing * servings
      const unit = comp.defaultUnit === 'piece' ? 'pcs' : comp.defaultUnit
      return `- ${comp.name}: ${Math.round(quantity)}${unit}`
    })
    .join('\n')
}

/**
 * Every `generateObject` argument the full preparation-tips call sends except
 * `model` and `abortSignal`. Pure, so the model benchmark (HON-795) sends the
 * request production sends, token ceiling included (HON-796).
 */
export function buildFullStepsRequest(input: StepsRequestInput) {
  const { mealName, servings, timeMinutes, components, locale } = input

  return {
    schema: fullStepsSchema,
    prompt: buildFullStepsPrompt({
      mealName,
      householdSize: servings,
      timeMinutes,
      ingredientsList: formatIngredientsList(components, servings),
      locale,
    }),
    // Same adaptive-thinking headroom as the supplementary call below
    // (HON-693). The full schema is larger, and on the same hard meal this
    // reached 892 output tokens (330 reasoning) — 89% of the old 1000, close
    // enough to truncation to move. On Sonnet 5.5 an 18-ingredient meal
    // reached 791 (HON-794).
    maxOutputTokens: 2000,
    maxRetries: 3,
  }
}

/**
 * Every `generateObject` argument the supplementary preparation-tips call
 * (the meal has the user's own notes) sends except `model` and `abortSignal`.
 */
export function buildSupplementaryStepsRequest(input: SupplementaryStepsRequestInput) {
  const { mealName, servings, timeMinutes, components, preparationNotes, locale } = input

  return {
    schema: supplementaryStepsSchema,
    prompt: buildSupplementaryStepsPrompt({
      mealName,
      householdSize: servings,
      timeMinutes,
      ingredientsList: formatIngredientsList(components, servings),
      preparationNotes,
      locale,
    }),
    // Sized for Sonnet 5's adaptive thinking (HON-693): reasoning tokens are
    // billed as output and count against this cap, so the old 400 was not a
    // tips-sized budget any more. Measured against a deliberately hard meal,
    // this call reached 593 output tokens (335 of them reasoning) and
    // truncated outright at 400 — `finish: 'length'`, then
    // NoObjectGeneratedError and no tips for the user. This is a ceiling, not
    // a target: a typical call still returns in ~195 tokens. On Sonnet 5.5 an
    // 18-ingredient meal reached 398 (HON-794).
    maxOutputTokens: 1200,
    maxRetries: 3,
  }
}
