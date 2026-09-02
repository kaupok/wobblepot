import { prisma } from '@/lib/prisma'
import { getCandidates, NO_REPEAT_DAYS, type CandidateMeal } from '@/lib/meal-planning/candidates'
import type { MealSlot } from '@/lib/meal-planning/slots'
import type { CandidatePools } from './types'
import type { Allergen, DietaryType, MealType } from '@/generated/prisma/enums'

const CANDIDATE_POOL_LIMIT = 50

/**
 * Cap a candidate pool to the limit, ensuring a mix of kid-friendly and adult meals.
 */
export function capPool(
  candidates: CandidateMeal[],
  limit = CANDIDATE_POOL_LIMIT,
): CandidateMeal[] {
  if (candidates.length <= limit) return candidates

  const kidFriendly = candidates.filter((c) => c.kidFriendly)
  const adult = candidates.filter((c) => !c.kidFriendly)

  const result: CandidateMeal[] = []
  const halfLimit = Math.floor(limit / 2)

  // Add kid-friendly meals (up to half)
  result.push(...kidFriendly.slice(0, halfLimit))

  // Fill remaining with adult meals
  const remaining = limit - result.length
  result.push(...adult.slice(0, remaining))

  // If we still have space, add more kid-friendly
  if (result.length < limit && kidFriendly.length > halfLimit) {
    result.push(...kidFriendly.slice(halfLimit, halfLimit + (limit - result.length)))
  }

  return result
}

/**
 * Get recent meal IDs used in the last NO_REPEAT_DAYS for a household.
 */
export async function getRecentMealIds(householdId: string): Promise<string[]> {
  // Normalize to local midnight to match database date storage
  const cutoffDate = new Date()
  cutoffDate.setHours(0, 0, 0, 0)
  cutoffDate.setDate(cutoffDate.getDate() - NO_REPEAT_DAYS)

  const recentEntries = await prisma.mealPlanEntry.findMany({
    where: {
      plan: { householdId },
      date: { gte: cutoffDate },
      mealId: { not: null },
    },
    select: { mealId: true },
  })

  return recentEntries.map((e) => e.mealId).filter((id): id is string => id !== null)
}

/**
 * Get favorite meal IDs for a household.
 */
export async function getFavoriteMealIds(householdId: string): Promise<string[]> {
  const favorites = await prisma.favoriteMeal.findMany({
    where: { householdId },
    select: { mealId: true },
  })

  return favorites.map((f) => f.mealId)
}

export interface LoadCandidatePoolsOptions {
  /** Slots being planned; their distinct meal types drive the per-type queries. */
  slots: MealSlot[]
  householdId: string
  allergensToAvoid: Allergen[]
  excludedIngredientIds: string[]
  recentMealIds: string[]
  dietaryType: DietaryType | null
  favoriteMealIds: string[]
}

export interface LoadCandidatePoolsResult {
  candidatePools: CandidatePools
  /**
   * Same map as `candidatePools.byMealType`, exposed non-optionally so callers
   * that must thread it into the prompt don't have to narrow the optional field.
   */
  candidatesByMealType: Map<MealType, CandidateMeal[]>
  /** Distinct meal types the pools were queried for, in slot order. */
  mealTypes: MealType[]
}

/**
 * Query the candidate pools a plan needs: one capped pool per meal type present in
 * `slots`, plus the protein-specific dinner pools used for balance constraints.
 *
 * Fish and legume meals are reserved — they are excluded from the generic `any`
 * dinner pool so the AI cannot deplete them on non-required slots and leave repair
 * unable to fix a required protein slot violation.
 */
export async function loadCandidatePools({
  slots,
  householdId,
  allergensToAvoid,
  excludedIngredientIds,
  recentMealIds,
  dietaryType,
  favoriteMealIds,
}: LoadCandidatePoolsOptions): Promise<LoadCandidatePoolsResult> {
  // Collect unique meal types to query candidates for
  const uniqueMealTypes = [...new Set(slots.map((s) => s.mealType))]

  // Query candidate pools for each meal type in parallel
  // Include both system meals and household's custom meals
  const candidatesByMealType = new Map<MealType, CandidateMeal[]>()
  await Promise.all(
    uniqueMealTypes.map(async (mealType) => {
      const candidates = await getCandidates({
        mealType,
        allergensToAvoid,
        excludedIngredientIds,
        recentMealIds,
        dietaryType,
        householdId,
        favoriteMealIds,
      })
      candidatesByMealType.set(mealType, capPool(candidates))
    }),
  )

  // For dinner slots, also query protein-specific pools for balance constraints
  const dinnerCandidates = candidatesByMealType.get('dinner') ?? []
  const [fishCandidates, legumeCandidates] = await Promise.all([
    getCandidates({
      mealType: 'dinner',
      allergensToAvoid,
      excludedIngredientIds,
      recentMealIds,
      dietaryType,
      primaryProteinType: 'fish',
      householdId,
      favoriteMealIds,
    }),
    getCandidates({
      mealType: 'dinner',
      allergensToAvoid,
      excludedIngredientIds,
      recentMealIds,
      dietaryType,
      primaryProteinType: 'legume',
      householdId,
      favoriteMealIds,
    }),
  ])

  // Build protein-specific pools first
  const fishPool = capPool(fishCandidates)
  const legumePool = capPool(legumeCandidates)

  // Exclude protein-specific pool meals from "any" pool to reserve them for required slots.
  const reservedMealIds = new Set([...fishPool.map((m) => m.id), ...legumePool.map((m) => m.id)])
  const anyPool = capPool(dinnerCandidates.filter((m) => !reservedMealIds.has(m.id)))

  return {
    candidatePools: {
      fish: fishPool,
      legume: legumePool,
      any: anyPool,
      byMealType: candidatesByMealType,
    },
    candidatesByMealType,
    mealTypes: uniqueMealTypes,
  }
}
