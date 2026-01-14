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
})
