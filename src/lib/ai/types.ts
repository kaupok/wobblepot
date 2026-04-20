import { z } from 'zod'
import type {
  Allergen,
  DietaryType,
  MealPlanEntryStatus,
  MealType,
  ProteinType,
} from '@/generated/prisma/enums'
import type { CandidateMeal } from '@/lib/meal-planning/candidates'
import type { MealSlot, SlotRequirement } from '@/lib/meal-planning/slots'
import type { AiUsageStats } from './usage'

/**
 * Zod schema for AI structured output.
 * AI returns an array of date + mealType + mealId entries.
 */
export const MealPlanResponseSchema = z.object({
  entries: z.array(
    z.object({
      date: z.string().describe('Date in YYYY-MM-DD format'),
      mealType: z.enum(['breakfast', 'lunch', 'dinner']).describe('The meal type for this slot'),
      mealId: z.string().describe('The meal ID from the candidates'),
    }),
  ),
})

export type MealPlanResponse = z.infer<typeof MealPlanResponseSchema>

/**
 * Candidate pools organized by protein type for slot-specific queries.
 * - fish/legume: Protein-specific pools for dinner balance constraints
 * - any: General dinner pool (legacy, used as fallback)
 * - byMealType: Pools for each meal type (used for non-dinner repairs)
 */
export interface CandidatePools {
  fish: CandidateMeal[]
  legume: CandidateMeal[]
  any: CandidateMeal[]
  byMealType?: Map<MealType, CandidateMeal[]>
}

/**
 * A plan entry hydrated with meal details from the database.
 */
export interface HydratedPlanEntry {
  date: Date
  mealType: MealType
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
  /** Start date of the generation range (inclusive, any day of week) */
  startDate: Date
  /** End date of the generation range (exclusive) */
  endDate: Date
  dietaryType: DietaryType | null
  allergensToAvoid: Allergen[]
  excludedIngredientIds: string[]
  restrictions: string[]
  /** Meal types to plan for weekdays (Mon-Fri). Defaults to ['dinner'] */
  weekdayMealTypes?: MealType[]
  /** Meal types to plan for weekends (Sat-Sun). Defaults to ['dinner'] */
  weekendMealTypes?: MealType[]
  /** Optional callback fired with token usage after the AI call returns. */
  onAiUsage?: (usage: AiUsageStats) => void
}

/**
 * Options for creating an empty meal plan (no entries).
 */
export interface CreateEmptyPlanOptions {
  householdId: string
  /** Start date of the range (inclusive, any day of week) */
  startDate: Date
  /** End date of the range (exclusive) */
  endDate: Date
}

/**
 * Options for filling empty slots in an existing meal plan.
 */
export interface FillEmptySlotsOptions {
  planId: string
  householdId: string
  /** Start date of the range (inclusive, any day of week) */
  startDate: Date
  /** End date of the range (exclusive) */
  endDate: Date
  dietaryType: DietaryType | null
  allergensToAvoid: Allergen[]
  excludedIngredientIds: string[]
  restrictions: string[]
  weekdayMealTypes: MealType[]
  weekendMealTypes: MealType[]
  /** Optional callback fired with token usage after the AI call returns. */
  onAiUsage?: (usage: AiUsageStats) => void
}

/**
 * The result of meal plan generation.
 */
export interface GeneratePlanResult {
  id: string
  /** Computed from entries for backward compat; not stored in DB */
  startDate: string
  /** Computed from entries for backward compat; not stored in DB */
  endDate: string
  entries: Array<{
    id: string
    date: string
    mealType: MealType
    status: MealPlanEntryStatus
    meal: {
      id: string
      name: string
      kidFriendly: boolean
      primaryProteinType: ProteinType
      nutrition: {
        calories: number
        protein: number
        carbs: number
        fat: number
      }
    } | null
  }>
  /** Warnings about slots that could not be filled (e.g., no candidates for a meal type). */
  warnings?: string[]
}

/**
 * Input for the prompt builder.
 */
export interface PromptInput {
  startDate: Date
  endDate: Date
  /** Total number of entries expected (supports partial weeks) */
  totalEntries: number
  /** Slots with required protein types (dinner only) */
  requiredSlots: SlotRequirement[]
  /** All remaining slots without protein requirements */
  remainingSlots: MealSlot[]
  candidatePools: CandidatePools
  restrictions: string[]
  /** Non-staple pantry ingredient names the household currently has in stock */
  pantryIngredients?: string[]
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

/**
 * Error thrown when fill-empty is requested but there are no empty slots.
 */
export class NoEmptySlotsError extends Error {
  constructor() {
    super('No empty slots to fill')
    this.name = 'NoEmptySlotsError'
  }
}

/**
 * Types of validation errors that can occur in a meal plan.
 */
export type ValidationErrorType =
  | 'wrong_protein'
  | 'consecutive_protein'
  | 'invalid_meal'
  | 'duplicate_meal'

/**
 * A single validation error found in a meal plan.
 */
export interface ValidationError {
  type: ValidationErrorType
  date: string
  mealType: MealType
  expected?: ProteinType
  actual?: ProteinType
  message: string
}

/**
 * Result of validating a meal plan.
 */
export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}
