import { z } from 'zod'
import type {
  Allergen,
  DietaryType,
  MealPlanEntryStatus,
  ProteinType,
} from '@/generated/prisma/enums'
import type { CandidateMeal } from '@/lib/meal-planning/candidates'
import type { SlotRequirement } from '@/lib/meal-planning/slots'

/**
 * Zod schema for AI structured output.
 * AI returns an array of date + mealId pairs.
 */
export const MealPlanResponseSchema = z.object({
  entries: z.array(
    z.object({
      date: z.string().describe('Date in YYYY-MM-DD format'),
      mealId: z.string().describe('The meal ID from the candidates'),
    }),
  ),
})

export type MealPlanResponse = z.infer<typeof MealPlanResponseSchema>

/**
 * Candidate pools organized by protein type for slot-specific queries.
 */
export interface CandidatePools {
  fish: CandidateMeal[]
  legume: CandidateMeal[]
  any: CandidateMeal[]
}

/**
 * A plan entry hydrated with meal details from the database.
 */
export interface HydratedPlanEntry {
  date: Date
  mealId: string
  meal: {
    id: string
    name: string
    primaryProteinType: ProteinType
    kidFriendly: boolean
  } | null
}

/**
 * Options for generating a meal plan.
 */
export interface GeneratePlanOptions {
  householdId: string
  startDate: Date
  dietaryType: DietaryType
  allergensToAvoid: Allergen[]
  excludedIngredientIds: string[]
  restrictions: string[]
}

/**
 * The result of meal plan generation.
 */
export interface GeneratePlanResult {
  id: string
  startDate: string
  endDate: string
  entries: Array<{
    id: string
    date: string
    mealType: 'dinner'
    status: MealPlanEntryStatus
    meal: {
      id: string
      name: string
      kidFriendly: boolean
      primaryProteinType: ProteinType
    } | null
  }>
}

/**
 * Input for the prompt builder.
 */
export interface PromptInput {
  startDate: Date
  endDate: Date
  requiredSlots: SlotRequirement[]
  remainingDates: Date[]
  candidatePools: CandidatePools
  restrictions: string[]
}

/**
 * Error thrown when AI response validation fails.
 */
export class MealPlanValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MealPlanValidationError'
  }
}

/**
 * Error thrown when a meal plan already exists for the given week.
 */
export class MealPlanExistsError extends Error {
  constructor(householdId: string, startDate: Date) {
    super(
      `A meal plan already exists for household ${householdId} starting ${startDate.toISOString()}`,
    )
    this.name = 'MealPlanExistsError'
  }
}

/**
 * Error thrown when there are insufficient candidates for required protein slots.
 */
export class InsufficientCandidatesError extends Error {
  constructor(proteinType: string) {
    super(`No ${proteinType} meals available matching household dietary constraints`)
    this.name = 'InsufficientCandidatesError'
  }
}
