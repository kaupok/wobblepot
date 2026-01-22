import { describe, it, expect } from 'vitest'
import { validatePlan } from './validate-plan'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import type { ProteinType } from '@/generated/prisma/enums'
import type { HydratedPlanEntry } from './types'
import type { SlotRequirement } from '@/lib/meal-planning/slots'

// Helper to create a date (using same parsing as production code)
function date(dateStr: string): Date {
  return parseLocalDate(dateStr)
}

// Helper to create a valid plan entry
function createEntry(
  dateStr: string,
  mealId: string,
  proteinType: ProteinType,
  mealType: 'breakfast' | 'lunch' | 'dinner' = 'dinner',
): HydratedPlanEntry {
  return {
    date: date(dateStr),
    mealType,
    mealId,
    meal: {
      id: mealId,
      name: `Meal ${mealId}`,
      primaryProteinType: proteinType,
      kidFriendly: true,
    },
  }
}

describe('validatePlan', () => {
  describe('returns valid for correct plan', () => {
    it('validates a plan with no required slots and varied proteins', () => {
      const plan: HydratedPlanEntry[] = [
        createEntry('2026-01-12', 'meal-1', 'poultry'),
        createEntry('2026-01-13', 'meal-2', 'beef'),
        createEntry('2026-01-14', 'meal-3', 'fish'),
        createEntry('2026-01-15', 'meal-4', 'legume'),
        createEntry('2026-01-16', 'meal-5', 'pork'),
        createEntry('2026-01-17', 'meal-6', 'poultry'),
        createEntry('2026-01-18', 'meal-7', 'fish'),
      ]

      const result = validatePlan(plan, [])

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('validates a plan with required slots matching correct protein types', () => {
      const plan: HydratedPlanEntry[] = [
        createEntry('2026-01-12', 'meal-1', 'poultry'),
        createEntry('2026-01-13', 'meal-2', 'beef'),
        createEntry('2026-01-14', 'meal-3', 'fish'), // Wednesday - required fish
        createEntry('2026-01-15', 'meal-4', 'poultry'),
        createEntry('2026-01-16', 'meal-5', 'pork'),
        createEntry('2026-01-17', 'meal-6', 'legume'), // Saturday - required legume
        createEntry('2026-01-18', 'meal-7', 'beef'),
      ]

      const requiredSlots: SlotRequirement[] = [
        { date: date('2026-01-14'), mealType: 'dinner', proteinType: 'fish' },
        { date: date('2026-01-17'), mealType: 'dinner', proteinType: 'legume' },
      ]

      const result = validatePlan(plan, requiredSlots)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('detects wrong protein on required slot', () => {
    it('returns error when required fish slot has chicken', () => {
      const plan: HydratedPlanEntry[] = [
        createEntry('2026-01-12', 'meal-1', 'poultry'),
        createEntry('2026-01-13', 'meal-2', 'beef'),
        createEntry('2026-01-14', 'meal-3', 'poultry'), // Should be fish!
        createEntry('2026-01-15', 'meal-4', 'pork'),
        createEntry('2026-01-16', 'meal-5', 'beef'),
        createEntry('2026-01-17', 'meal-6', 'legume'),
        createEntry('2026-01-18', 'meal-7', 'poultry'),
      ]

      const requiredSlots: SlotRequirement[] = [
        { date: date('2026-01-14'), mealType: 'dinner', proteinType: 'fish' },
      ]

      const result = validatePlan(plan, requiredSlots)

      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toEqual({
        type: 'wrong_protein',
        date: '2026-01-14',
        mealType: 'dinner',
        expected: 'fish',
        actual: 'poultry',
        message: '2026-01-14 dinner requires fish, got poultry',
      })
    })

    it('returns error when required legume slot has beef', () => {
      const plan: HydratedPlanEntry[] = [
        createEntry('2026-01-12', 'meal-1', 'poultry'),
        createEntry('2026-01-13', 'meal-2', 'fish'),
        createEntry('2026-01-14', 'meal-3', 'beef'),
        createEntry('2026-01-15', 'meal-4', 'pork'),
        createEntry('2026-01-16', 'meal-5', 'poultry'),
        createEntry('2026-01-17', 'meal-6', 'beef'), // Should be legume!
        createEntry('2026-01-18', 'meal-7', 'fish'),
      ]

      const requiredSlots: SlotRequirement[] = [
        { date: date('2026-01-17'), mealType: 'dinner', proteinType: 'legume' },
      ]

      const result = validatePlan(plan, requiredSlots)

      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]!.type).toBe('wrong_protein')
      expect(result.errors[0]!.expected).toBe('legume')
      expect(result.errors[0]!.actual).toBe('beef')
    })
  })

  describe('detects consecutive same protein types', () => {
    it('returns error when two consecutive days have chicken', () => {
      const plan: HydratedPlanEntry[] = [
        createEntry('2026-01-12', 'meal-1', 'poultry'),
        createEntry('2026-01-13', 'meal-2', 'poultry'), // Consecutive!
        createEntry('2026-01-14', 'meal-3', 'fish'),
        createEntry('2026-01-15', 'meal-4', 'legume'),
        createEntry('2026-01-16', 'meal-5', 'pork'),
        createEntry('2026-01-17', 'meal-6', 'beef'),
        createEntry('2026-01-18', 'meal-7', 'fish'),
      ]

      const result = validatePlan(plan, [])

      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toEqual({
        type: 'consecutive_protein',
        date: '2026-01-13',
        mealType: 'dinner',
        actual: 'poultry',
        message: 'Consecutive poultry for dinner on 2026-01-12 and 2026-01-13',
      })
    })

    it('returns multiple errors for multiple consecutive violations', () => {
      const plan: HydratedPlanEntry[] = [
        createEntry('2026-01-12', 'meal-1', 'poultry'),
        createEntry('2026-01-13', 'meal-2', 'poultry'), // Consecutive!
        createEntry('2026-01-14', 'meal-3', 'fish'),
        createEntry('2026-01-15', 'meal-4', 'fish'), // Consecutive!
        createEntry('2026-01-16', 'meal-5', 'pork'),
        createEntry('2026-01-17', 'meal-6', 'beef'),
        createEntry('2026-01-18', 'meal-7', 'beef'), // Consecutive!
      ]

      const result = validatePlan(plan, [])

      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(3)
      expect(result.errors.map((e) => e.type)).toEqual([
        'consecutive_protein',
        'consecutive_protein',
        'consecutive_protein',
      ])
    })
  })

  describe('detects invalid/null meals', () => {
    it('returns error when meal is null', () => {
      const plan: HydratedPlanEntry[] = [
        createEntry('2026-01-12', 'meal-1', 'poultry'),
        createEntry('2026-01-13', 'meal-2', 'beef'),
        {
          date: date('2026-01-14'),
          mealType: 'dinner',
          mealId: 'invalid-meal-id',
          meal: null,
        },
        createEntry('2026-01-15', 'meal-4', 'legume'),
        createEntry('2026-01-16', 'meal-5', 'pork'),
        createEntry('2026-01-17', 'meal-6', 'poultry'),
        createEntry('2026-01-18', 'meal-7', 'fish'),
      ]

      const result = validatePlan(plan, [])

      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toEqual({
        type: 'invalid_meal',
        date: '2026-01-14',
        mealType: 'dinner',
        message: 'Invalid meal ID invalid-meal-id on 2026-01-14 dinner',
      })
    })
  })

  describe('detects duplicate meals', () => {
    it('returns error when same meal ID is used twice', () => {
      const plan: HydratedPlanEntry[] = [
        createEntry('2026-01-12', 'meal-1', 'poultry'),
        createEntry('2026-01-13', 'meal-2', 'beef'),
        createEntry('2026-01-14', 'meal-3', 'fish'),
        createEntry('2026-01-15', 'meal-1', 'poultry'), // Duplicate of meal-1!
        createEntry('2026-01-16', 'meal-5', 'pork'),
        createEntry('2026-01-17', 'meal-6', 'legume'),
        createEntry('2026-01-18', 'meal-7', 'beef'),
      ]

      const result = validatePlan(plan, [])

      expect(result.valid).toBe(false)
      // Should have consecutive_protein (both meal-1 entries are chicken nearby) and duplicate_meal
      const duplicateErrors = result.errors.filter((e) => e.type === 'duplicate_meal')
      expect(duplicateErrors).toHaveLength(1)
      expect(duplicateErrors[0]!.date).toBe('2026-01-15')
    })
  })

  describe('ignores balance rules for breakfast/lunch', () => {
    it('allows consecutive same protein for breakfast', () => {
      const plan: HydratedPlanEntry[] = [
        createEntry('2026-01-12', 'meal-1', 'none', 'breakfast'),
        createEntry('2026-01-13', 'meal-2', 'none', 'breakfast'), // Consecutive none - OK for breakfast
        createEntry('2026-01-14', 'meal-3', 'none', 'breakfast'),
        createEntry('2026-01-15', 'meal-4', 'none', 'breakfast'),
        createEntry('2026-01-16', 'meal-5', 'none', 'breakfast'),
        createEntry('2026-01-17', 'meal-6', 'none', 'breakfast'),
        createEntry('2026-01-18', 'meal-7', 'none', 'breakfast'),
      ]

      const result = validatePlan(plan, [])

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('allows duplicate meals for breakfast', () => {
      const plan: HydratedPlanEntry[] = [
        createEntry('2026-01-12', 'oatmeal', 'none', 'breakfast'),
        createEntry('2026-01-13', 'oatmeal', 'none', 'breakfast'), // Duplicate - OK for breakfast
        createEntry('2026-01-14', 'toast', 'none', 'breakfast'),
        createEntry('2026-01-15', 'oatmeal', 'none', 'breakfast'), // Duplicate again - OK
        createEntry('2026-01-16', 'toast', 'none', 'breakfast'),
        createEntry('2026-01-17', 'oatmeal', 'none', 'breakfast'),
        createEntry('2026-01-18', 'toast', 'none', 'breakfast'),
      ]

      const result = validatePlan(plan, [])

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('allows consecutive same protein for lunch', () => {
      const plan: HydratedPlanEntry[] = [
        createEntry('2026-01-12', 'meal-1', 'poultry', 'lunch'),
        createEntry('2026-01-13', 'meal-2', 'poultry', 'lunch'), // Consecutive poultry - OK for lunch
        createEntry('2026-01-14', 'meal-3', 'poultry', 'lunch'),
      ]

      const result = validatePlan(plan, [])

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('still enforces consecutive protein rule for dinner', () => {
      const plan: HydratedPlanEntry[] = [
        // Breakfast is fine with consecutive none
        createEntry('2026-01-12', 'oats-1', 'none', 'breakfast'),
        createEntry('2026-01-13', 'oats-2', 'none', 'breakfast'),
        // But dinner must have variety
        createEntry('2026-01-12', 'meal-1', 'poultry', 'dinner'),
        createEntry('2026-01-13', 'meal-2', 'poultry', 'dinner'), // Error: consecutive poultry
      ]

      const result = validatePlan(plan, [])

      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]!.type).toBe('consecutive_protein')
      expect(result.errors[0]!.mealType).toBe('dinner')
    })

    it('still enforces duplicate meal rule for dinner', () => {
      const plan: HydratedPlanEntry[] = [
        // Breakfast allows duplicates
        createEntry('2026-01-12', 'oatmeal', 'none', 'breakfast'),
        createEntry('2026-01-13', 'oatmeal', 'none', 'breakfast'),
        // But dinner does not
        createEntry('2026-01-12', 'dinner-1', 'poultry', 'dinner'),
        createEntry('2026-01-13', 'dinner-2', 'beef', 'dinner'),
        createEntry('2026-01-14', 'dinner-1', 'poultry', 'dinner'), // Error: duplicate dinner
      ]

      const result = validatePlan(plan, [])

      expect(result.valid).toBe(false)
      const duplicateErrors = result.errors.filter((e) => e.type === 'duplicate_meal')
      expect(duplicateErrors).toHaveLength(1)
      expect(duplicateErrors[0]!.mealType).toBe('dinner')
    })
  })

  describe('collects multiple errors', () => {
    it('returns all errors at once', () => {
      const plan: HydratedPlanEntry[] = [
        createEntry('2026-01-12', 'meal-1', 'poultry'),
        createEntry('2026-01-13', 'meal-1', 'poultry'), // Duplicate AND consecutive!
        createEntry('2026-01-14', 'meal-3', 'beef'), // Wrong - should be fish
        {
          date: date('2026-01-15'),
          mealType: 'dinner',
          mealId: 'invalid',
          meal: null, // Invalid meal
        },
        createEntry('2026-01-16', 'meal-5', 'pork'),
        createEntry('2026-01-17', 'meal-6', 'beef'), // Wrong - should be legume
        createEntry('2026-01-18', 'meal-7', 'fish'),
      ]

      const requiredSlots: SlotRequirement[] = [
        { date: date('2026-01-14'), mealType: 'dinner', proteinType: 'fish' },
        { date: date('2026-01-17'), mealType: 'dinner', proteinType: 'legume' },
      ]

      const result = validatePlan(plan, requiredSlots)

      expect(result.valid).toBe(false)
      // Errors: 2 wrong_protein, 1 consecutive_protein, 1 invalid_meal, 1 duplicate_meal
      expect(result.errors.length).toBeGreaterThanOrEqual(5)

      const errorTypes = result.errors.map((e) => e.type)
      expect(errorTypes).toContain('wrong_protein')
      expect(errorTypes).toContain('consecutive_protein')
      expect(errorTypes).toContain('invalid_meal')
      expect(errorTypes).toContain('duplicate_meal')
    })
  })
})
