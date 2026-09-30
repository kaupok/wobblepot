import { describe, it, expect, vi } from 'vitest'
import { parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import type { CandidateMeal } from '@/lib/meal-planning/candidates'
import type { SlotRequirement } from '@/lib/meal-planning/slots'
import type { ProteinType } from '@/generated/prisma/enums'
import { MealPlanValidationError, type CandidatePools, type HydratedPlanEntry } from './types'

// hydratePlan is not exercised here; the mock only keeps the real client from loading.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { validateAndRepairPlan } from './plan-helpers'

// validatePlan and repairPlan are real here (generate-plan.test.ts mocks both),
// so these cover the whole repair path a generated plan goes through.

function entry(dateStr: string, mealId: string, proteinType: ProteinType): HydratedPlanEntry {
  return {
    date: parseLocalDate(dateStr),
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

function unknownEntry(dateStr: string): HydratedPlanEntry {
  return { date: parseLocalDate(dateStr), mealType: 'dinner', mealId: 'no-such-meal', meal: null }
}

function candidate(id: string, proteinType: ProteinType): CandidateMeal {
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

const pools: CandidatePools = {
  fish: [candidate('fish-1', 'fish')],
  legume: [candidate('legume-1', 'legume')],
  any: [candidate('any-beef-1', 'beef'), candidate('any-lamb-1', 'lamb')],
}

describe('validateAndRepairPlan', () => {
  it('resolves a plan with an unknown meal ID by substituting a candidate', () => {
    const plan = [
      entry('2026-10-04', 'meal-1', 'poultry'),
      unknownEntry('2026-10-05'),
      entry('2026-10-06', 'meal-3', 'pork'),
    ]

    const result = validateAndRepairPlan(plan, [], pools)

    const monday = result.find((e) => toDateString(e.date) === '2026-10-05')!
    expect(monday.mealId).toBe('any-beef-1')
    expect(monday.meal?.name).toBe('Candidate any-beef-1')
  })

  it('fills a required protein slot with that protein so re-validation passes', () => {
    const plan = [entry('2026-10-04', 'meal-1', 'poultry'), unknownEntry('2026-10-05')]
    const requiredSlots: SlotRequirement[] = [
      { date: parseLocalDate('2026-10-05'), mealType: 'dinner', proteinType: 'legume' },
    ]

    const result = validateAndRepairPlan(plan, requiredSlots, pools)

    expect(result[1]!.mealId).toBe('legume-1')
  })

  it('throws MealPlanValidationError when the slot pool is empty', () => {
    const plan = [unknownEntry('2026-10-05')]

    expect(() => validateAndRepairPlan(plan, [], { ...pools, any: [] })).toThrow(
      MealPlanValidationError,
    )
    expect(() => validateAndRepairPlan(plan, [], { ...pools, any: [] })).toThrow(
      'repair not possible',
    )
  })
})
