import { describe, it, expect } from 'vitest'
import { buildMealPlanPrompt } from './prompts'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import type { PromptInput } from './types'
import type { MealSlot, SlotRequirement } from '@/lib/meal-planning/slots'
import type { CandidateMeal } from '@/lib/meal-planning/candidates'
import { ProteinType, IngredientCategory } from '@/generated/prisma/enums'

// Helper to create a date
function date(dateStr: string): Date {
  return parseLocalDate(dateStr)
}

// Helper to create a candidate meal
function createCandidate(overrides: {
  id?: string
  name?: string
  kidFriendly?: boolean
  primaryProteinType?: ProteinType
  isFavorite?: boolean
  isCustom?: boolean
}): CandidateMeal {
  return {
    id: overrides.id ?? 'meal-1',
    name: overrides.name ?? 'Test Meal',
    kidFriendly: overrides.kidFriendly ?? false,
    primaryProteinType: overrides.primaryProteinType ?? ProteinType.poultry,
    topIngredients: [
      { name: 'Chicken', category: IngredientCategory.protein },
      { name: 'Rice', category: IngredientCategory.carb },
    ],
    isFavorite: overrides.isFavorite ?? false,
    isCustom: overrides.isCustom ?? false,
  }
}

// Helper to convert dates to MealSlot array (dinner only for tests)
function datesToSlots(dates: Date[]): MealSlot[] {
  return dates.map((d) => ({ date: d, mealType: 'dinner' as const }))
}

// Helper to create basic input
function createInput(overrides: Partial<PromptInput> = {}): PromptInput {
  const startDate = date('2026-01-12')
  const endDate = date('2026-01-19')
  const defaultDates = [
    date('2026-01-12'),
    date('2026-01-13'),
    date('2026-01-14'),
    date('2026-01-15'),
    date('2026-01-16'),
    date('2026-01-17'),
    date('2026-01-18'),
  ]
  const remainingSlots = overrides.remainingSlots ?? datesToSlots(defaultDates)
  const requiredSlots = overrides.requiredSlots ?? []
  // Calculate totalEntries from remaining slots and required slots
  const totalEntries = overrides.totalEntries ?? remainingSlots.length + requiredSlots.length

  return {
    startDate,
    endDate,
    totalEntries,
    requiredSlots,
    remainingSlots,
    candidatePools: {
      fish: [],
      legume: [],
      any: [
        createCandidate({
          id: 'meal-1',
          name: 'Chicken Rice',
          primaryProteinType: ProteinType.poultry,
        }),
        createCandidate({ id: 'meal-2', name: 'Beef Stew', primaryProteinType: ProteinType.beef }),
      ],
    },
    restrictions: [],
    ...overrides,
  }
}

describe('buildMealPlanPrompt', () => {
  describe('required slots section', () => {
    it('shows "No required protein slots" when no slots are required', () => {
      const input = createInput({ requiredSlots: [] })

      const result = buildMealPlanPrompt(input)

      expect(result).toContain('No required protein slots for this dietary type.')
    })

    it('formats fish required slot with candidates', () => {
      const fishCandidates: CandidateMeal[] = [
        createCandidate({
          id: 'fish-1',
          name: 'Salmon',
          primaryProteinType: ProteinType.fish,
          kidFriendly: true,
        }),
        createCandidate({
          id: 'fish-2',
          name: 'Cod',
          primaryProteinType: ProteinType.fish,
          kidFriendly: false,
        }),
      ]

      const requiredSlots: SlotRequirement[] = [
        { date: date('2026-01-14'), mealType: 'dinner', proteinType: 'fish' },
      ]

      const input = createInput({
        requiredSlots,
        candidatePools: {
          fish: fishCandidates,
          legume: [],
          any: [],
        },
      })

      const result = buildMealPlanPrompt(input)

      expect(result).toContain('Wed 2026-01-14 dinner: MUST be FISH')
      expect(result).toContain('"id":"fish-1"')
      expect(result).toContain('"name":"Salmon"')
      expect(result).toContain('"proteinType":"fish"')
      expect(result).toContain('"kidFriendly":true')
    })

    it('formats legume required slot with candidates', () => {
      const legumeCandidates: CandidateMeal[] = [
        createCandidate({
          id: 'legume-1',
          name: 'Lentil Soup',
          primaryProteinType: ProteinType.legume,
        }),
      ]

      const requiredSlots: SlotRequirement[] = [
        { date: date('2026-01-17'), mealType: 'dinner', proteinType: 'legume' },
      ]

      const input = createInput({
        requiredSlots,
        candidatePools: {
          fish: [],
          legume: legumeCandidates,
          any: [],
        },
      })

      const result = buildMealPlanPrompt(input)

      expect(result).toContain('Sat 2026-01-17 dinner: MUST be LEGUME')
      expect(result).toContain('"id":"legume-1"')
      expect(result).toContain('"name":"Lentil Soup"')
    })

    it('formats multiple required slots', () => {
      const requiredSlots: SlotRequirement[] = [
        { date: date('2026-01-14'), mealType: 'dinner', proteinType: 'fish' },
        { date: date('2026-01-17'), mealType: 'dinner', proteinType: 'legume' },
      ]

      const input = createInput({
        requiredSlots,
        candidatePools: {
          fish: [createCandidate({ id: 'fish-1', primaryProteinType: ProteinType.fish })],
          legume: [createCandidate({ id: 'legume-1', primaryProteinType: ProteinType.legume })],
          any: [],
        },
      })

      const result = buildMealPlanPrompt(input)

      expect(result).toContain('MUST be FISH')
      expect(result).toContain('MUST be LEGUME')
    })
  })

  describe('remaining days section', () => {
    it('lists remaining dates with any candidates', () => {
      const input = createInput({
        remainingSlots: datesToSlots([date('2026-01-12'), date('2026-01-13'), date('2026-01-15')]),
      })

      const result = buildMealPlanPrompt(input)

      expect(result).toContain('DINNER slots: Mon 2026-01-12, Tue 2026-01-13, Thu 2026-01-15')
    })

    it('includes any candidates as JSON', () => {
      const input = createInput({
        candidatePools: {
          fish: [],
          legume: [],
          any: [
            createCandidate({ id: 'any-1', name: 'Meal A', kidFriendly: true }),
            createCandidate({ id: 'any-2', name: 'Meal B', kidFriendly: false }),
          ],
        },
      })

      const result = buildMealPlanPrompt(input)

      // Check candidates are included after REMAINING SLOTS
      expect(result).toContain('"id":"any-1"')
      expect(result).toContain('"name":"Meal A"')
      expect(result).toContain('"id":"any-2"')
      expect(result).toContain('"name":"Meal B"')
    })
  })

  describe('variety rules', () => {
    it('includes standard variety rules', () => {
      const input = createInput()

      const result = buildMealPlanPrompt(input)

      expect(result).toContain('VARIETY RULES:')
      expect(result).toContain('No same proteinType on consecutive days for the same meal type')
      expect(result).toContain('Mix kid-friendly and adult meals')
      expect(result).toContain('Each meal can only be used once across all slots (no duplicates)')
    })
  })

  describe('restrictions', () => {
    it('does not include dietary preferences line when restrictions are empty', () => {
      const input = createInput({ restrictions: [] })

      const result = buildMealPlanPrompt(input)

      expect(result).not.toContain('Dietary preferences')
    })

    it('includes dietary preferences when restrictions are provided', () => {
      const input = createInput({ restrictions: ['low FODMAP', 'no spicy food'] })

      const result = buildMealPlanPrompt(input)

      expect(result).toContain('Dietary preferences (best effort): low FODMAP, no spicy food')
    })

    it('includes single restriction', () => {
      const input = createInput({ restrictions: ['keto-friendly'] })

      const result = buildMealPlanPrompt(input)

      expect(result).toContain('Dietary preferences (best effort): keto-friendly')
    })
  })

  describe('date range', () => {
    it('includes correct start and end dates in output instruction', () => {
      const input = createInput({
        startDate: date('2026-01-12'),
        endDate: date('2026-01-19'), // endDate is exclusive
      })

      const result = buildMealPlanPrompt(input)

      // endDate is exclusive, so last day is 2026-01-18
      expect(result).toContain('Return exactly 7 entries covering 2026-01-12 through 2026-01-18')
      expect(result).toContain('date (YYYY-MM-DD format)')
    })

    it('handles different week correctly', () => {
      const input = createInput({
        startDate: date('2026-02-02'),
        endDate: date('2026-02-09'),
        remainingSlots: datesToSlots([
          date('2026-02-02'),
          date('2026-02-03'),
          date('2026-02-04'),
          date('2026-02-05'),
          date('2026-02-06'),
          date('2026-02-07'),
          date('2026-02-08'),
        ]),
      })

      const result = buildMealPlanPrompt(input)

      expect(result).toContain('Return exactly 7 entries covering 2026-02-02 through 2026-02-08')
    })

    it('handles partial week (mid-week signup)', () => {
      // Wednesday through Sunday = 5 days
      const input = createInput({
        startDate: date('2026-01-12'), // Monday (week start)
        endDate: date('2026-01-19'), // Next Monday (exclusive)
        totalEntries: 5, // Wed-Sun
        requiredSlots: [], // No required slots for this test
        remainingSlots: datesToSlots([
          date('2026-01-14'), // Wed
          date('2026-01-15'), // Thu
          date('2026-01-16'), // Fri
          date('2026-01-17'), // Sat
          date('2026-01-18'), // Sun
        ]),
      })

      const result = buildMealPlanPrompt(input)

      // Should use first actual entry date (Wed), not Monday
      expect(result).toContain('Return exactly 5 entries covering 2026-01-14 through 2026-01-18')
    })

    it('uses first required slot date when earlier than remaining dates', () => {
      // Required slot on Wed, remaining dates Thu-Sun
      const input = createInput({
        startDate: date('2026-01-12'), // Monday
        endDate: date('2026-01-19'),
        totalEntries: 5,
        requiredSlots: [{ date: date('2026-01-14'), mealType: 'dinner', proteinType: 'fish' }], // Wed
        remainingSlots: datesToSlots([
          date('2026-01-15'), // Thu
          date('2026-01-16'), // Fri
          date('2026-01-17'), // Sat
          date('2026-01-18'), // Sun
        ]),
        candidatePools: {
          fish: [createCandidate({ id: 'fish-1', primaryProteinType: ProteinType.fish })],
          legume: [],
          any: [],
        },
      })

      const result = buildMealPlanPrompt(input)

      // Should use Wed (from required slot) as first date
      expect(result).toContain('Return exactly 5 entries covering 2026-01-14 through 2026-01-18')
    })
  })

  describe('pantry context', () => {
    it('does not include pantry section when pantryIngredients is undefined', () => {
      const input = createInput()

      const result = buildMealPlanPrompt(input)

      expect(result).not.toContain('PANTRY')
    })

    it('does not include pantry section when pantryIngredients is empty', () => {
      const input = createInput({ pantryIngredients: [] })

      const result = buildMealPlanPrompt(input)

      expect(result).not.toContain('PANTRY')
    })

    it('includes pantry section with ingredient names', () => {
      const input = createInput({
        pantryIngredients: ['Chicken breast', 'Rice', 'Soy sauce'],
      })

      const result = buildMealPlanPrompt(input)

      expect(result).toContain('PANTRY (ingredients the household already has):')
      expect(result).toContain('Chicken breast, Rice, Soy sauce')
    })

    it('includes soft preference guidance', () => {
      const input = createInput({
        pantryIngredients: ['Salmon'],
      })

      const result = buildMealPlanPrompt(input)

      expect(result).toContain('prefer ones that use these ingredients')
      expect(result).toContain('soft preference, not a hard constraint')
    })

    it('places pantry section after personalization and before restrictions', () => {
      const input = createInput({
        pantryIngredients: ['Chicken breast'],
        restrictions: ['low sodium'],
      })

      const result = buildMealPlanPrompt(input)

      const personalizationIndex = result.indexOf('PERSONALIZATION')
      const pantryIndex = result.indexOf('PANTRY')
      const restrictionsIndex = result.indexOf('Dietary preferences')

      expect(personalizationIndex).toBeLessThan(pantryIndex)
      expect(pantryIndex).toBeLessThan(restrictionsIndex)
    })
  })

  describe('complete prompt structure', () => {
    it('produces well-structured prompt with all sections', () => {
      // Use explicit totalEntries to ensure correct structure test
      const input = createInput({
        totalEntries: 7,
        requiredSlots: [{ date: date('2026-01-14'), mealType: 'dinner', proteinType: 'fish' }],
        remainingSlots: datesToSlots([
          date('2026-01-12'),
          date('2026-01-13'),
          date('2026-01-15'),
          date('2026-01-16'),
          date('2026-01-17'),
          date('2026-01-18'),
        ]),
        restrictions: ['low sodium'],
        candidatePools: {
          fish: [createCandidate({ id: 'fish-1', primaryProteinType: ProteinType.fish })],
          legume: [],
          any: [createCandidate({ id: 'any-1' })],
        },
      })

      const result = buildMealPlanPrompt(input)

      // Check overall structure order
      const requiredSlotsIndex = result.indexOf('REQUIRED SLOTS')
      const remainingDaysIndex = result.indexOf('REMAINING SLOTS')
      const varietyRulesIndex = result.indexOf('VARIETY RULES')
      const returnIndex = result.indexOf('Return exactly')

      expect(requiredSlotsIndex).toBeLessThan(remainingDaysIndex)
      expect(remainingDaysIndex).toBeLessThan(varietyRulesIndex)
      expect(varietyRulesIndex).toBeLessThan(returnIndex)
    })
  })
})
