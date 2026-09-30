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

  it('moves the neighbour when a required fill lands next to the same protein', () => {
    // validatePlan never checks consecutive proteins beside a null meal, so the
    // fish-fish pair only appears after Mon is filled; the second pass fixes it.
    const plan = [unknownEntry('2026-10-05'), entry('2026-10-06', 'meal-2', 'fish')]
    const requiredSlots: SlotRequirement[] = [
      { date: parseLocalDate('2026-10-05'), mealType: 'dinner', proteinType: 'fish' },
    ]

    const result = validateAndRepairPlan(plan, requiredSlots, pools)

    expect(result[0]!.mealId).toBe('fish-1')
    expect(result[1]!.meal?.primaryProteinType).not.toBe('fish')
  })

  it('keeps a later required slot when an earlier unknown ID was filled with its protein', () => {
    // Tue (unknown, unrequired) is listed first and repaired while Mon is still
    // null, so it can take a fish. Mon then gets its required fish.
    const plan = [
      unknownEntry('2026-10-06'),
      { ...unknownEntry('2026-10-05'), mealId: 'also-missing' },
    ]
    const requiredSlots: SlotRequirement[] = [
      { date: parseLocalDate('2026-10-05'), mealType: 'dinner', proteinType: 'fish' },
    ]
    const fishFirst: CandidatePools = {
      ...pools,
      fish: [candidate('fish-1', 'fish')],
      any: [candidate('any-fish-1', 'fish'), candidate('any-beef-1', 'beef')],
    }

    const result = validateAndRepairPlan(plan, requiredSlots, fishFirst)

    const monday = result.find((e) => toDateString(e.date) === '2026-10-05')!
    const tuesday = result.find((e) => toDateString(e.date) === '2026-10-06')!
    expect(monday.mealId).toBe('fish-1')
    expect(tuesday.meal?.primaryProteinType).toBe('beef')
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
