import { describe, it, expect } from 'vitest'
import { repairPlan } from './repair-plan'
import { toDateString, parseLocalDate } from '@/lib/meal-planning/dates'
import type { ProteinType } from '@/generated/prisma/enums'
import type { CandidatePools, HydratedPlanEntry, ValidationError } from './types'
import type { CandidateMeal } from '@/lib/meal-planning/candidates'

// Helper to create a date (using same parsing as production code)
function date(dateStr: string): Date {
  return parseLocalDate(dateStr)
}

// Helper to create a valid plan entry
function createEntry(dateStr: string, mealId: string, proteinType: ProteinType): HydratedPlanEntry {
  return {
    date: date(dateStr),
    mealType: 'dinner',
    mealId,
    meal: {
      id: mealId,
      name: `Meal ${mealId}`,
      primaryProteinType: proteinType,
      kidFriendly: true,
    },
  }
}

// Helper to create a candidate meal
function createCandidate(id: string, proteinType: ProteinType): CandidateMeal {
  return {
    id,
    name: `Candidate ${id}`,
    primaryProteinType: proteinType,
    kidFriendly: true,
    topIngredients: [],
    isFavorite: false,
    isCustom: false,
  }
}

// Default candidate pools for tests
function createPools(overrides?: Partial<CandidatePools>): CandidatePools {
  return {
    fish: [
      createCandidate('fish-1', 'fish'),
      createCandidate('fish-2', 'fish'),
      createCandidate('fish-3', 'fish'),
    ],
    legume: [
      createCandidate('legume-1', 'legume'),
      createCandidate('legume-2', 'legume'),
      createCandidate('legume-3', 'legume'),
    ],
    any: [
      createCandidate('any-chicken-1', 'poultry'),
      createCandidate('any-beef-1', 'beef'),
      createCandidate('any-fish-1', 'fish'),
      createCandidate('any-legume-1', 'legume'),
      createCandidate('any-pork-1', 'pork'),
    ],
    ...overrides,
  }
}

describe('repairPlan', () => {
  describe('fixes wrong protein on required slot', () => {
    it('swaps chicken entry with fish from fish pool', () => {
      const plan: HydratedPlanEntry[] = [
        createEntry('2026-01-12', 'meal-1', 'poultry'),
        createEntry('2026-01-13', 'meal-2', 'beef'),
        createEntry('2026-01-14', 'meal-3', 'poultry'), // Should be fish
        createEntry('2026-01-15', 'meal-4', 'legume'),
        createEntry('2026-01-16', 'meal-5', 'pork'),
        createEntry('2026-01-17', 'meal-6', 'beef'),
        createEntry('2026-01-18', 'meal-7', 'poultry'),
      ]

      const errors: ValidationError[] = [
        {
          type: 'wrong_protein',
          date: '2026-01-14',
          mealType: 'dinner',
          expected: 'fish',
          actual: 'poultry',
          message: '2026-01-14 requires fish, got chicken',
        },
      ]

      const pools = createPools()
      const result = repairPlan(plan, errors, pools)

      expect(result).not.toBeNull()
      const entry = result!.find((e) => toDateString(e.date) === '2026-01-14')
      expect(entry?.meal?.primaryProteinType).toBe('fish')
      expect(entry?.mealId).toBe('fish-1')
    })

    it('swaps beef entry with legume from legume pool', () => {
      const plan: HydratedPlanEntry[] = [
        createEntry('2026-01-12', 'meal-1', 'poultry'),
        createEntry('2026-01-13', 'meal-2', 'fish'),
        createEntry('2026-01-14', 'meal-3', 'pork'),
        createEntry('2026-01-15', 'meal-4', 'poultry'),
        createEntry('2026-01-16', 'meal-5', 'beef'),
        createEntry('2026-01-17', 'meal-6', 'beef'), // Should be legume
        createEntry('2026-01-18', 'meal-7', 'fish'),
      ]

      const errors: ValidationError[] = [
        {
          type: 'wrong_protein',
          date: '2026-01-17',
          mealType: 'dinner',
          expected: 'legume',
          actual: 'beef',
          message: '2026-01-17 requires legume, got beef',
        },
      ]

      const pools = createPools()
      const result = repairPlan(plan, errors, pools)

      expect(result).not.toBeNull()
      const entry = result!.find((e) => toDateString(e.date) === '2026-01-17')
      expect(entry?.meal?.primaryProteinType).toBe('legume')
    })
  })

  describe('fixes consecutive protein violations', () => {
    it('swaps one of two consecutive chicken days with different protein', () => {
      const plan: HydratedPlanEntry[] = [
        createEntry('2026-01-12', 'meal-1', 'beef'),
        createEntry('2026-01-13', 'meal-2', 'poultry'),
        createEntry('2026-01-14', 'meal-3', 'poultry'), // Consecutive chicken
        createEntry('2026-01-15', 'meal-4', 'fish'),
        createEntry('2026-01-16', 'meal-5', 'legume'),
        createEntry('2026-01-17', 'meal-6', 'pork'),
        createEntry('2026-01-18', 'meal-7', 'beef'),
      ]

      const errors: ValidationError[] = [
        {
          type: 'consecutive_protein',
          date: '2026-01-14',
          mealType: 'dinner',
          actual: 'poultry',
          message: 'Consecutive chicken on 2026-01-13 and 2026-01-14',
        },
      ]

      const pools = createPools()
      const result = repairPlan(plan, errors, pools)

      expect(result).not.toBeNull()

      // Either entry can be swapped, but they shouldn't both be chicken anymore
      const entry13 = result!.find((e) => toDateString(e.date) === '2026-01-13')
      const entry14 = result!.find((e) => toDateString(e.date) === '2026-01-14')

      expect(entry13?.meal?.primaryProteinType !== entry14?.meal?.primaryProteinType).toBe(true)
    })
  })

  describe('fixes duplicate meals', () => {
    it('swaps duplicate meal with different candidate of same protein type', () => {
      const plan: HydratedPlanEntry[] = [
        createEntry('2026-01-12', 'meal-1', 'poultry'),
        createEntry('2026-01-13', 'meal-2', 'beef'),
        createEntry('2026-01-14', 'meal-3', 'fish'),
        createEntry('2026-01-15', 'meal-1', 'poultry'), // Duplicate of meal-1
        createEntry('2026-01-16', 'meal-5', 'pork'),
        createEntry('2026-01-17', 'meal-6', 'legume'),
        createEntry('2026-01-18', 'meal-7', 'beef'),
      ]

      const errors: ValidationError[] = [
        {
          type: 'duplicate_meal',
          date: '2026-01-15',
          mealType: 'dinner',
          message: 'Duplicate meal Meal meal-1 (meal-1) on 2026-01-15',
        },
      ]

      const pools = createPools()
      const result = repairPlan(plan, errors, pools)

      expect(result).not.toBeNull()

      // The duplicate should be replaced with a different meal
      const entry15 = result!.find((e) => toDateString(e.date) === '2026-01-15')
      expect(entry15?.mealId).not.toBe('meal-1')

      // All meal IDs should be unique
      const mealIds = result!.map((e) => e.mealId)
      expect(new Set(mealIds).size).toBe(mealIds.length)
    })
  })

  describe('returns null when repair is not possible', () => {
    it('returns null when fish pool is empty', () => {
      const plan: HydratedPlanEntry[] = [
        createEntry('2026-01-12', 'meal-1', 'poultry'),
        createEntry('2026-01-13', 'meal-2', 'beef'),
        createEntry('2026-01-14', 'meal-3', 'poultry'), // Should be fish
        createEntry('2026-01-15', 'meal-4', 'legume'),
        createEntry('2026-01-16', 'meal-5', 'pork'),
        createEntry('2026-01-17', 'meal-6', 'beef'),
        createEntry('2026-01-18', 'meal-7', 'poultry'),
      ]

      const errors: ValidationError[] = [
        {
          type: 'wrong_protein',
          date: '2026-01-14',
          mealType: 'dinner',
          expected: 'fish',
          actual: 'poultry',
          message: '2026-01-14 requires fish, got chicken',
        },
      ]

      const pools = createPools({ fish: [] })
      const result = repairPlan(plan, errors, pools)

      expect(result).toBeNull()
    })

    it('returns null for invalid_meal errors (cannot fix without original intent)', () => {
      const plan: HydratedPlanEntry[] = [
        createEntry('2026-01-12', 'meal-1', 'poultry'),
        createEntry('2026-01-13', 'meal-2', 'beef'),
        {
          date: date('2026-01-14'),
          mealType: 'dinner',
          mealId: 'invalid-meal',
          meal: null,
        },
        createEntry('2026-01-15', 'meal-4', 'legume'),
        createEntry('2026-01-16', 'meal-5', 'pork'),
        createEntry('2026-01-17', 'meal-6', 'beef'),
        createEntry('2026-01-18', 'meal-7', 'poultry'),
      ]

      const errors: ValidationError[] = [
        {
          type: 'invalid_meal',
          date: '2026-01-14',
          mealType: 'dinner',
          message: 'Invalid meal ID invalid-meal on 2026-01-14',
        },
      ]

      const pools = createPools()
      const result = repairPlan(plan, errors, pools)

      expect(result).toBeNull()
    })

    it('returns null when all candidates in pool are already used', () => {
      const plan: HydratedPlanEntry[] = [
        createEntry('2026-01-12', 'fish-1', 'fish'),
        createEntry('2026-01-13', 'fish-2', 'fish'), // Consecutive!
        createEntry('2026-01-14', 'fish-3', 'fish'), // Consecutive!
        createEntry('2026-01-15', 'meal-4', 'legume'),
        createEntry('2026-01-16', 'meal-5', 'pork'),
        createEntry('2026-01-17', 'meal-6', 'beef'),
        createEntry('2026-01-18', 'meal-7', 'poultry'),
      ]

      const errors: ValidationError[] = [
        {
          type: 'wrong_protein',
          date: '2026-01-14',
          mealType: 'dinner',
          expected: 'fish',
          actual: 'fish', // Actually the type is correct, but let's test with wrong_protein
          message: 'Test error',
        },
      ]

      // All fish candidates are already used in the plan
      const pools = createPools({
        fish: [
          createCandidate('fish-1', 'fish'),
          createCandidate('fish-2', 'fish'),
          createCandidate('fish-3', 'fish'),
        ],
      })

      const result = repairPlan(plan, errors, pools)

      expect(result).toBeNull()
    })
  })

  describe('does not create new duplicates', () => {
    it('skips already-used candidates when swapping', () => {
      const plan: HydratedPlanEntry[] = [
        createEntry('2026-01-12', 'fish-1', 'fish'), // Using fish-1 from pool
        createEntry('2026-01-13', 'meal-2', 'beef'),
        createEntry('2026-01-14', 'meal-3', 'poultry'), // Should be fish
        createEntry('2026-01-15', 'meal-4', 'legume'),
        createEntry('2026-01-16', 'meal-5', 'pork'),
        createEntry('2026-01-17', 'meal-6', 'beef'),
        createEntry('2026-01-18', 'meal-7', 'poultry'),
      ]

      const errors: ValidationError[] = [
        {
          type: 'wrong_protein',
          date: '2026-01-14',
          mealType: 'dinner',
          expected: 'fish',
          actual: 'poultry',
          message: '2026-01-14 requires fish, got chicken',
        },
      ]

      const pools = createPools()
      const result = repairPlan(plan, errors, pools)

      expect(result).not.toBeNull()

      // Should use fish-2 or fish-3, not fish-1 which is already used
      const entry14 = result!.find((e) => toDateString(e.date) === '2026-01-14')
      expect(entry14?.mealId).not.toBe('fish-1')
      expect(['fish-2', 'fish-3']).toContain(entry14?.mealId)

      // All meal IDs should be unique
      const mealIds = result!.map((e) => e.mealId)
      expect(new Set(mealIds).size).toBe(mealIds.length)
    })
  })

  describe('handles multiple errors', () => {
    it('does not undo required slot fix when processing consecutive error', () => {
      // Reproduces bug: wrong_protein fixes 01-30 to legume, but consecutive_protein
      // then tries to "fix" 01-31 (which was consecutive 'none' with 01-30), potentially
      // undoing the required slot fix or failing to repair properly
      const plan: HydratedPlanEntry[] = [
        createEntry('2026-01-26', 'meal-1', 'poultry'),
        createEntry('2026-01-27', 'meal-2', 'beef'),
        createEntry('2026-01-28', 'meal-3', 'fish'),
        createEntry('2026-01-29', 'meal-4', 'pork'),
        createEntry('2026-01-30', 'meal-5', 'none'), // Required legume slot, got none
        createEntry('2026-01-31', 'meal-6', 'none'), // Consecutive 'none' with 01-30
        createEntry('2026-02-01', 'meal-7', 'poultry'),
      ]

      const errors: ValidationError[] = [
        // wrong_protein comes first (from required slot check)
        {
          type: 'wrong_protein',
          date: '2026-01-30',
          mealType: 'dinner',
          expected: 'legume',
          actual: 'none',
          message: '2026-01-30 dinner requires legume, got none',
        },
        // consecutive_protein comes second (error.date = second day of the pair)
        {
          type: 'consecutive_protein',
          date: '2026-01-31',
          mealType: 'dinner',
          actual: 'none',
          message: 'Consecutive none for dinner on 2026-01-30 and 2026-01-31',
        },
      ]

      const pools = createPools()
      const result = repairPlan(plan, errors, pools)

      expect(result).not.toBeNull()

      // The required legume slot MUST be preserved
      const entry30 = result!.find((e) => toDateString(e.date) === '2026-01-30')
      expect(entry30?.meal?.primaryProteinType).toBe('legume')

      // The consecutive error should also be resolved (proteins should differ)
      const entry31 = result!.find((e) => toDateString(e.date) === '2026-01-31')
      expect(entry30?.meal?.primaryProteinType).not.toBe(entry31?.meal?.primaryProteinType)
    })

    it('skips consecutive error when previous wrong_protein fix already resolved it', () => {
      // When wrong_protein fixes a slot from 'none' to 'legume', the consecutive_protein
      // error for that pair is already resolved and should be skipped
      const plan: HydratedPlanEntry[] = [
        createEntry('2026-01-26', 'meal-1', 'poultry'),
        createEntry('2026-01-27', 'meal-2', 'beef'),
        createEntry('2026-01-28', 'meal-3', 'fish'),
        createEntry('2026-01-29', 'meal-4', 'pork'),
        createEntry('2026-01-30', 'meal-5', 'none'), // Required legume slot, got none
        createEntry('2026-01-31', 'meal-6', 'none'), // Consecutive 'none' with 01-30
        createEntry('2026-02-01', 'meal-7', 'poultry'),
      ]

      const errors: ValidationError[] = [
        {
          type: 'wrong_protein',
          date: '2026-01-30',
          mealType: 'dinner',
          expected: 'legume',
          actual: 'none',
          message: '2026-01-30 dinner requires legume, got none',
        },
        {
          type: 'consecutive_protein',
          date: '2026-01-31',
          mealType: 'dinner',
          actual: 'none',
          message: 'Consecutive none for dinner on 2026-01-30 and 2026-01-31',
        },
      ]

      // Pools where 'any' only has 'none' proteins - simulates production scenario
      // where most dinner candidates have primaryProteinType: 'none'
      const pools: CandidatePools = {
        fish: [createCandidate('fish-1', 'fish')],
        legume: [createCandidate('legume-1', 'legume')],
        any: [
          createCandidate('any-none-1', 'none'),
          createCandidate('any-none-2', 'none'),
          createCandidate('any-none-3', 'none'),
        ],
      }

      const result = repairPlan(plan, errors, pools)

      expect(result).not.toBeNull()

      // The required legume slot MUST be preserved
      const entry30 = result!.find((e) => toDateString(e.date) === '2026-01-30')
      expect(entry30?.meal?.primaryProteinType).toBe('legume')

      // 01-31 stays 'none' because:
      // 1. wrong_protein fixed 01-30 from 'none' to 'legume'
      // 2. consecutive error is now resolved (legume != none)
      // 3. No need to modify 01-31
      const entry31 = result!.find((e) => toDateString(e.date) === '2026-01-31')
      // The proteins should be different (consecutive resolved)
      expect(entry30?.meal?.primaryProteinType).not.toBe(entry31?.meal?.primaryProteinType)
    })

    it('repairs multiple issues in a single pass', () => {
      const plan: HydratedPlanEntry[] = [
        createEntry('2026-01-12', 'meal-1', 'poultry'),
        createEntry('2026-01-13', 'meal-1', 'poultry'), // Duplicate AND consecutive
        createEntry('2026-01-14', 'meal-3', 'beef'), // Should be fish
        createEntry('2026-01-15', 'meal-4', 'pork'),
        createEntry('2026-01-16', 'meal-5', 'beef'),
        createEntry('2026-01-17', 'meal-6', 'poultry'), // Should be legume
        createEntry('2026-01-18', 'meal-7', 'fish'),
      ]

      const errors: ValidationError[] = [
        {
          type: 'wrong_protein',
          date: '2026-01-14',
          mealType: 'dinner',
          expected: 'fish',
          actual: 'beef',
          message: '2026-01-14 requires fish, got beef',
        },
        {
          type: 'wrong_protein',
          date: '2026-01-17',
          mealType: 'dinner',
          expected: 'legume',
          actual: 'poultry',
          message: '2026-01-17 requires legume, got chicken',
        },
        {
          type: 'consecutive_protein',
          date: '2026-01-13',
          mealType: 'dinner',
          actual: 'poultry',
          message: 'Consecutive chicken on 2026-01-12 and 2026-01-13',
        },
        {
          type: 'duplicate_meal',
          date: '2026-01-13',
          mealType: 'dinner',
          message: 'Duplicate meal Meal meal-1 (meal-1) on 2026-01-13',
        },
      ]

      const pools = createPools()
      const result = repairPlan(plan, errors, pools)

      expect(result).not.toBeNull()

      // Check fish slot is fixed
      const entry14 = result!.find((e) => toDateString(e.date) === '2026-01-14')
      expect(entry14?.meal?.primaryProteinType).toBe('fish')

      // Check legume slot is fixed
      const entry17 = result!.find((e) => toDateString(e.date) === '2026-01-17')
      expect(entry17?.meal?.primaryProteinType).toBe('legume')
    })
  })

  describe('uses meal-type-specific pools for non-dinner repairs', () => {
    it('uses breakfast pool for consecutive protein on breakfast slots', () => {
      // Helper to create breakfast entry
      function createBreakfastEntry(
        dateStr: string,
        mealId: string,
        proteinType: ProteinType,
      ): HydratedPlanEntry {
        return {
          date: date(dateStr),
          mealType: 'breakfast',
          mealId,
          meal: {
            id: mealId,
            name: `Breakfast ${mealId}`,
            primaryProteinType: proteinType,
            kidFriendly: true,
          },
        }
      }

      const plan: HydratedPlanEntry[] = [
        createBreakfastEntry('2026-01-12', 'breakfast-1', 'poultry'),
        createBreakfastEntry('2026-01-13', 'breakfast-2', 'poultry'), // Consecutive!
        createBreakfastEntry('2026-01-14', 'breakfast-3', 'beef'),
      ]

      const errors: ValidationError[] = [
        {
          type: 'consecutive_protein',
          date: '2026-01-13',
          mealType: 'breakfast',
          actual: 'poultry',
          message: 'Consecutive poultry for breakfast on 2026-01-12 and 2026-01-13',
        },
      ]

      // Create pools with byMealType for breakfast
      const breakfastCandidates: CandidateMeal[] = [
        createCandidate('breakfast-beef', 'beef'),
        createCandidate('breakfast-pork', 'pork'),
      ]

      const pools: CandidatePools = {
        fish: [],
        legume: [],
        any: [], // Empty dinner pool - repair should fail if it uses this
        byMealType: new Map([['breakfast', breakfastCandidates]]),
      }

      const result = repairPlan(plan, errors, pools)

      expect(result).not.toBeNull()

      // Should have used a breakfast candidate, not dinner
      const entry13 = result!.find((e) => toDateString(e.date) === '2026-01-13')
      expect(['breakfast-beef', 'breakfast-pork']).toContain(entry13?.mealId)
    })

    it('uses lunch pool for duplicate meal on lunch slots', () => {
      // Helper to create lunch entry
      function createLunchEntry(
        dateStr: string,
        mealId: string,
        proteinType: ProteinType,
      ): HydratedPlanEntry {
        return {
          date: date(dateStr),
          mealType: 'lunch',
          mealId,
          meal: {
            id: mealId,
            name: `Lunch ${mealId}`,
            primaryProteinType: proteinType,
            kidFriendly: true,
          },
        }
      }

      const plan: HydratedPlanEntry[] = [
        createLunchEntry('2026-01-12', 'lunch-1', 'poultry'),
        createLunchEntry('2026-01-13', 'lunch-1', 'poultry'), // Duplicate!
        createLunchEntry('2026-01-14', 'lunch-3', 'beef'),
      ]

      const errors: ValidationError[] = [
        {
          type: 'duplicate_meal',
          date: '2026-01-13',
          mealType: 'lunch',
          message: 'Duplicate meal Lunch lunch-1 (lunch-1) on 2026-01-13 lunch',
        },
      ]

      // Create pools with byMealType for lunch
      const lunchCandidates: CandidateMeal[] = [
        createCandidate('lunch-chicken-2', 'poultry'),
        createCandidate('lunch-beef-1', 'beef'),
      ]

      const pools: CandidatePools = {
        fish: [],
        legume: [],
        any: [], // Empty dinner pool - repair should fail if it uses this
        byMealType: new Map([['lunch', lunchCandidates]]),
      }

      const result = repairPlan(plan, errors, pools)

      expect(result).not.toBeNull()

      // Should have used a lunch candidate, not dinner
      const entry13 = result!.find((e) => toDateString(e.date) === '2026-01-13')
      expect(['lunch-chicken-2', 'lunch-beef-1']).toContain(entry13?.mealId)
      expect(entry13?.mealId).not.toBe('lunch-1') // Not the duplicate
    })

    it('falls back to any pool when byMealType is not provided', () => {
      // Helper to create lunch entry
      function createLunchEntry(
        dateStr: string,
        mealId: string,
        proteinType: ProteinType,
      ): HydratedPlanEntry {
        return {
          date: date(dateStr),
          mealType: 'lunch',
          mealId,
          meal: {
            id: mealId,
            name: `Lunch ${mealId}`,
            primaryProteinType: proteinType,
            kidFriendly: true,
          },
        }
      }

      const plan: HydratedPlanEntry[] = [
        createLunchEntry('2026-01-12', 'lunch-1', 'poultry'),
        createLunchEntry('2026-01-13', 'lunch-1', 'poultry'), // Duplicate!
      ]

      const errors: ValidationError[] = [
        {
          type: 'duplicate_meal',
          date: '2026-01-13',
          mealType: 'lunch',
          message: 'Duplicate meal',
        },
      ]

      // Pools without byMealType - should fall back to 'any'
      const pools = createPools()

      const result = repairPlan(plan, errors, pools)

      expect(result).not.toBeNull()
      const entry13 = result!.find((e) => toDateString(e.date) === '2026-01-13')
      expect(entry13?.mealId).not.toBe('lunch-1')
    })
  })
})
