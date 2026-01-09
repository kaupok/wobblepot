/**
 * Balance Constraints Test Script
 *
 * Smoke tests for slot computation and validation logic.
 * Tests deterministic parts of the meal planning system without AI.
 *
 * Usage: npx tsx scripts/test-balance-constraints.ts
 */

import 'dotenv/config'
import { prisma } from '../src/lib/prisma'

// Local type to match Prisma's Allergen enum
type Allergen =
  | 'gluten'
  | 'dairy'
  | 'eggs'
  | 'nuts'
  | 'peanuts'
  | 'soy'
  | 'fish'
  | 'shellfish'
  | 'sesame'

// ============================================
// TYPES
// ============================================

type DietaryType = 'omnivore' | 'vegetarian' | 'vegan' | 'pescatarian'
type ProteinType =
  | 'poultry'
  | 'beef'
  | 'pork'
  | 'lamb'
  | 'fish'
  | 'eggs'
  | 'legume'
  | 'dairy'
  | 'none'

interface SlotRequirement {
  date: Date
  proteinType: ProteinType
}

interface HydratedPlanEntry {
  date: Date
  mealId: string
  meal: {
    id: string
    name: string
    primaryProteinType: ProteinType
    kidFriendly: boolean
  } | null
}

interface ValidationError {
  type:
    | 'slot_violation'
    | 'consecutive_protein'
    | 'duplicate_meal'
    | 'invalid_meal'
    | 'missing_entries'
    | 'duplicate_date'
  date?: Date
  dates?: Date[]
  expected?: ProteinType
  mealId?: string
  count?: number
}

interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

interface TestResult {
  name: string
  passed: boolean
  message?: string
}

// ============================================
// LOGGING UTILITIES
// ============================================

const log = {
  section: (title: string) => {
    console.log('\n' + '='.repeat(60))
    console.log(` ${title}`)
    console.log('='.repeat(60))
  },
  subsection: (title: string) => {
    console.log(`\n--- ${title} ---`)
  },
  pass: (name: string) => console.log(`  [PASS] ${name}`),
  fail: (name: string, reason?: string) =>
    console.log(`  [FAIL] ${name}${reason ? `: ${reason}` : ''}`),
  warn: (msg: string) => console.log(`  [WARN] ${msg}`),
  info: (msg: string) => console.log(`  [INFO] ${msg}`),
}

// ============================================
// DATE UTILITIES
// ============================================

function getWeekDates(startDate: Date): [Date, Date, Date, Date, Date, Date, Date] {
  const dates: Date[] = []
  for (let i = 0; i < 7; i++) {
    const date = new Date(startDate)
    date.setDate(startDate.getDate() + i)
    dates.push(date)
  }
  return dates as [Date, Date, Date, Date, Date, Date, Date]
}

function toDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getMonday(refDate: Date = new Date()): Date {
  const d = new Date(refDate)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  return d
}

type DayPosition = 'midweek' | 'weekend' | 'early' | 'late'

function pickDay(dates: [Date, Date, Date, Date, Date, Date, Date], position: DayPosition): Date {
  const positionMap: Record<DayPosition, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
    midweek: 2, // Wednesday
    weekend: 5, // Saturday
    early: 1, // Tuesday
    late: 4, // Friday
  }
  return dates[positionMap[position]]
}

// ============================================
// SLOT COMPUTATION (copy from test-ai-selection.ts)
// ============================================

function computeRequiredSlots(
  dietaryType: DietaryType,
  dates: [Date, Date, Date, Date, Date, Date, Date]
): SlotRequirement[] {
  if (dietaryType === 'omnivore') {
    return [
      { date: pickDay(dates, 'midweek'), proteinType: 'fish' },
      { date: pickDay(dates, 'weekend'), proteinType: 'legume' },
    ]
  }
  if (dietaryType === 'pescatarian') {
    return [
      { date: pickDay(dates, 'early'), proteinType: 'fish' },
      { date: pickDay(dates, 'late'), proteinType: 'fish' },
      { date: pickDay(dates, 'midweek'), proteinType: 'legume' },
    ]
  }
  if (dietaryType === 'vegetarian' || dietaryType === 'vegan') {
    return [
      { date: pickDay(dates, 'early'), proteinType: 'legume' },
      { date: pickDay(dates, 'late'), proteinType: 'legume' },
    ]
  }
  return []
}

// ============================================
// VALIDATION (copy from test-ai-selection.ts)
// ============================================

function validatePlan(
  plan: HydratedPlanEntry[],
  requiredSlots: SlotRequirement[],
  expectedDates: Date[]
): ValidationResult {
  const errors: ValidationError[] = []

  // Check for correct number of entries
  if (plan.length !== expectedDates.length) {
    errors.push({ type: 'missing_entries', count: plan.length })
  }

  // Check for duplicate dates and coverage
  const planDateStrings = plan.map((e) => toDateString(e.date))
  const uniquePlanDates = new Set(planDateStrings)
  if (uniquePlanDates.size !== planDateStrings.length) {
    errors.push({ type: 'duplicate_date' })
  }

  // Check each expected date is covered
  for (const expectedDate of expectedDates) {
    const expectedDateStr = toDateString(expectedDate)
    if (!uniquePlanDates.has(expectedDateStr)) {
      errors.push({ type: 'missing_entries', date: expectedDate })
    }
  }

  // Check for invalid meal IDs
  for (const entry of plan) {
    if (!entry.meal) {
      errors.push({ type: 'invalid_meal', date: entry.date, mealId: entry.mealId })
    }
  }

  // Check required slots
  for (const slot of requiredSlots) {
    const entry = plan.find((e) => toDateString(e.date) === toDateString(slot.date))
    if (!entry?.meal || entry.meal.primaryProteinType !== slot.proteinType) {
      errors.push({
        type: 'slot_violation',
        date: slot.date,
        expected: slot.proteinType,
      })
    }
  }

  // Check consecutive days
  const sorted = [...plan].sort((a, b) => a.date.getTime() - b.date.getTime())
  for (let i = 1; i < sorted.length; i++) {
    const currentEntry = sorted[i]
    const previousEntry = sorted[i - 1]
    if (!currentEntry || !previousEntry) continue

    const dayDiff = Math.round(
      (currentEntry.date.getTime() - previousEntry.date.getTime()) / (1000 * 60 * 60 * 24)
    )
    if (dayDiff !== 1) continue

    const current = currentEntry.meal?.primaryProteinType
    const previous = previousEntry.meal?.primaryProteinType
    if (current && previous && current === previous && current !== 'none') {
      errors.push({
        type: 'consecutive_protein',
        dates: [previousEntry.date, currentEntry.date],
      })
    }
  }

  // Check duplicates
  const mealIds = plan.map((e) => e.mealId).filter(Boolean)
  if (new Set(mealIds).size !== mealIds.length) {
    errors.push({ type: 'duplicate_meal' })
  }

  return { valid: errors.length === 0, errors }
}

// ============================================
// TEST HELPERS
// ============================================

function createMockMeal(
  id: string,
  name: string,
  proteinType: ProteinType
): HydratedPlanEntry['meal'] {
  return { id, name, primaryProteinType: proteinType, kidFriendly: false }
}

function createMockPlanEntry(
  date: Date,
  mealId: string,
  meal: HydratedPlanEntry['meal']
): HydratedPlanEntry {
  return { date, mealId, meal }
}

// ============================================
// TEST SUITE: SLOT COMPUTATION
// ============================================

function testSlotComputation(): TestResult[] {
  const results: TestResult[] = []
  const monday = getMonday()
  const dates = getWeekDates(monday)

  log.subsection('Omnivore')
  {
    const slots = computeRequiredSlots('omnivore', dates)

    // Should have 2 slots: fish on Wed, legume on Sat
    const hasTwoSlots = slots.length === 2
    results.push({
      name: 'Omnivore: has 2 required slots',
      passed: hasTwoSlots,
      message: hasTwoSlots ? undefined : `Expected 2 slots, got ${slots.length}`,
    })

    const fishSlot = slots.find((s) => s.proteinType === 'fish')
    const fishOnWed = fishSlot && fishSlot.date.getDay() === 3
    results.push({
      name: 'Omnivore: fish slot on Wednesday',
      passed: !!fishOnWed,
      message: fishOnWed ? undefined : `Fish slot on day ${fishSlot?.date.getDay()}`,
    })

    const legumeSlot = slots.find((s) => s.proteinType === 'legume')
    const legumeOnSat = legumeSlot && legumeSlot.date.getDay() === 6
    results.push({
      name: 'Omnivore: legume slot on Saturday',
      passed: !!legumeOnSat,
      message: legumeOnSat ? undefined : `Legume slot on day ${legumeSlot?.date.getDay()}`,
    })
  }

  log.subsection('Pescatarian')
  {
    const slots = computeRequiredSlots('pescatarian', dates)

    // Should have 3 slots: fish Tue, fish Fri, legume Wed
    const hasThreeSlots = slots.length === 3
    results.push({
      name: 'Pescatarian: has 3 required slots',
      passed: hasThreeSlots,
      message: hasThreeSlots ? undefined : `Expected 3 slots, got ${slots.length}`,
    })

    const fishSlots = slots.filter((s) => s.proteinType === 'fish')
    const hasTwoFish = fishSlots.length === 2
    results.push({
      name: 'Pescatarian: has 2 fish slots',
      passed: hasTwoFish,
      message: hasTwoFish ? undefined : `Expected 2 fish slots, got ${fishSlots.length}`,
    })

    const fishDays = fishSlots.map((s) => s.date.getDay()).sort()
    const fishOnTueFri = fishDays[0] === 2 && fishDays[1] === 5
    results.push({
      name: 'Pescatarian: fish on Tuesday and Friday',
      passed: fishOnTueFri,
      message: fishOnTueFri ? undefined : `Fish on days ${fishDays.join(', ')}`,
    })

    const legumeSlot = slots.find((s) => s.proteinType === 'legume')
    const legumeOnWed = legumeSlot && legumeSlot.date.getDay() === 3
    results.push({
      name: 'Pescatarian: legume on Wednesday',
      passed: !!legumeOnWed,
      message: legumeOnWed ? undefined : `Legume on day ${legumeSlot?.date.getDay()}`,
    })
  }

  log.subsection('Vegetarian')
  {
    const slots = computeRequiredSlots('vegetarian', dates)

    const hasTwoSlots = slots.length === 2
    results.push({
      name: 'Vegetarian: has 2 required slots',
      passed: hasTwoSlots,
      message: hasTwoSlots ? undefined : `Expected 2 slots, got ${slots.length}`,
    })

    const allLegume = slots.every((s) => s.proteinType === 'legume')
    results.push({
      name: 'Vegetarian: all slots are legume',
      passed: allLegume,
    })

    const legumeDays = slots.map((s) => s.date.getDay()).sort()
    const legumeOnTueFri = legumeDays[0] === 2 && legumeDays[1] === 5
    results.push({
      name: 'Vegetarian: legume on Tuesday and Friday',
      passed: legumeOnTueFri,
      message: legumeOnTueFri ? undefined : `Legume on days ${legumeDays.join(', ')}`,
    })
  }

  log.subsection('Vegan')
  {
    const slots = computeRequiredSlots('vegan', dates)

    const hasTwoSlots = slots.length === 2
    results.push({
      name: 'Vegan: has 2 required slots',
      passed: hasTwoSlots,
      message: hasTwoSlots ? undefined : `Expected 2 slots, got ${slots.length}`,
    })

    const allLegume = slots.every((s) => s.proteinType === 'legume')
    results.push({
      name: 'Vegan: all slots are legume',
      passed: allLegume,
    })

    const legumeDays = slots.map((s) => s.date.getDay()).sort()
    const legumeOnTueFri = legumeDays[0] === 2 && legumeDays[1] === 5
    results.push({
      name: 'Vegan: legume on Tuesday and Friday',
      passed: legumeOnTueFri,
      message: legumeOnTueFri ? undefined : `Legume on days ${legumeDays.join(', ')}`,
    })
  }

  return results
}

// ============================================
// TEST SUITE: VALIDATION RULES
// ============================================

function testValidationRules(): TestResult[] {
  const results: TestResult[] = []
  const monday = getMonday()
  const dates = getWeekDates(monday)
  const requiredSlots = computeRequiredSlots('omnivore', dates)

  log.subsection('Valid plan passes validation')
  {
    // Create a valid plan with correct slots and no violations
    const plan: HydratedPlanEntry[] = [
      createMockPlanEntry(dates[0], 'm1', createMockMeal('m1', 'Chicken Monday', 'poultry')),
      createMockPlanEntry(dates[1], 'm2', createMockMeal('m2', 'Beef Tuesday', 'beef')),
      createMockPlanEntry(dates[2], 'm3', createMockMeal('m3', 'Fish Wednesday', 'fish')), // required
      createMockPlanEntry(dates[3], 'm4', createMockMeal('m4', 'Pork Thursday', 'pork')),
      createMockPlanEntry(dates[4], 'm5', createMockMeal('m5', 'Lamb Friday', 'lamb')),
      createMockPlanEntry(dates[5], 'm6', createMockMeal('m6', 'Legume Saturday', 'legume')), // required
      createMockPlanEntry(dates[6], 'm7', createMockMeal('m7', 'Eggs Sunday', 'eggs')),
    ]

    const validation = validatePlan(plan, requiredSlots, dates)
    results.push({
      name: 'Valid plan: passes validation',
      passed: validation.valid,
      message: validation.valid ? undefined : `Errors: ${JSON.stringify(validation.errors)}`,
    })
  }

  log.subsection('Slot violation detection')
  {
    // Fish slot has poultry instead
    const plan: HydratedPlanEntry[] = [
      createMockPlanEntry(dates[0], 'm1', createMockMeal('m1', 'Monday', 'poultry')),
      createMockPlanEntry(dates[1], 'm2', createMockMeal('m2', 'Tuesday', 'beef')),
      createMockPlanEntry(dates[2], 'm3', createMockMeal('m3', 'Wednesday', 'poultry')), // Should be fish!
      createMockPlanEntry(dates[3], 'm4', createMockMeal('m4', 'Thursday', 'pork')),
      createMockPlanEntry(dates[4], 'm5', createMockMeal('m5', 'Friday', 'lamb')),
      createMockPlanEntry(dates[5], 'm6', createMockMeal('m6', 'Saturday', 'legume')),
      createMockPlanEntry(dates[6], 'm7', createMockMeal('m7', 'Sunday', 'eggs')),
    ]

    const validation = validatePlan(plan, requiredSlots, dates)
    const hasSlotViolation = validation.errors.some((e) => e.type === 'slot_violation')
    results.push({
      name: 'Slot violation: detected when fish slot has poultry',
      passed: hasSlotViolation && !validation.valid,
      message: hasSlotViolation ? undefined : 'Expected slot_violation error',
    })
  }

  log.subsection('Consecutive protein detection')
  {
    // Two poultry days in a row
    const plan: HydratedPlanEntry[] = [
      createMockPlanEntry(dates[0], 'm1', createMockMeal('m1', 'Monday', 'poultry')),
      createMockPlanEntry(dates[1], 'm2', createMockMeal('m2', 'Tuesday', 'poultry')), // Consecutive!
      createMockPlanEntry(dates[2], 'm3', createMockMeal('m3', 'Wednesday', 'fish')),
      createMockPlanEntry(dates[3], 'm4', createMockMeal('m4', 'Thursday', 'pork')),
      createMockPlanEntry(dates[4], 'm5', createMockMeal('m5', 'Friday', 'lamb')),
      createMockPlanEntry(dates[5], 'm6', createMockMeal('m6', 'Saturday', 'legume')),
      createMockPlanEntry(dates[6], 'm7', createMockMeal('m7', 'Sunday', 'eggs')),
    ]

    const validation = validatePlan(plan, requiredSlots, dates)
    const hasConsecutive = validation.errors.some((e) => e.type === 'consecutive_protein')
    results.push({
      name: 'Consecutive protein: detected when same protein on adjacent days',
      passed: hasConsecutive && !validation.valid,
      message: hasConsecutive ? undefined : 'Expected consecutive_protein error',
    })
  }

  log.subsection('Consecutive "none" protein allowed')
  {
    // Two "none" days in a row should be OK
    const plan: HydratedPlanEntry[] = [
      createMockPlanEntry(dates[0], 'm1', createMockMeal('m1', 'Monday', 'none')),
      createMockPlanEntry(dates[1], 'm2', createMockMeal('m2', 'Tuesday', 'none')), // Consecutive none is OK
      createMockPlanEntry(dates[2], 'm3', createMockMeal('m3', 'Wednesday', 'fish')),
      createMockPlanEntry(dates[3], 'm4', createMockMeal('m4', 'Thursday', 'pork')),
      createMockPlanEntry(dates[4], 'm5', createMockMeal('m5', 'Friday', 'lamb')),
      createMockPlanEntry(dates[5], 'm6', createMockMeal('m6', 'Saturday', 'legume')),
      createMockPlanEntry(dates[6], 'm7', createMockMeal('m7', 'Sunday', 'eggs')),
    ]

    const validation = validatePlan(plan, requiredSlots, dates)
    const hasConsecutive = validation.errors.some((e) => e.type === 'consecutive_protein')
    results.push({
      name: 'Consecutive "none" protein: allowed (no error)',
      passed: !hasConsecutive,
      message: hasConsecutive ? 'Should not flag consecutive "none" proteins' : undefined,
    })
  }

  log.subsection('Duplicate meal detection')
  {
    // Same meal ID used twice
    const plan: HydratedPlanEntry[] = [
      createMockPlanEntry(dates[0], 'm1', createMockMeal('m1', 'Monday', 'poultry')),
      createMockPlanEntry(dates[1], 'm1', createMockMeal('m1', 'Monday', 'poultry')), // Duplicate!
      createMockPlanEntry(dates[2], 'm3', createMockMeal('m3', 'Wednesday', 'fish')),
      createMockPlanEntry(dates[3], 'm4', createMockMeal('m4', 'Thursday', 'pork')),
      createMockPlanEntry(dates[4], 'm5', createMockMeal('m5', 'Friday', 'lamb')),
      createMockPlanEntry(dates[5], 'm6', createMockMeal('m6', 'Saturday', 'legume')),
      createMockPlanEntry(dates[6], 'm7', createMockMeal('m7', 'Sunday', 'eggs')),
    ]

    const validation = validatePlan(plan, requiredSlots, dates)
    const hasDuplicate = validation.errors.some((e) => e.type === 'duplicate_meal')
    results.push({
      name: 'Duplicate meal: detected when same meal used twice',
      passed: hasDuplicate && !validation.valid,
      message: hasDuplicate ? undefined : 'Expected duplicate_meal error',
    })
  }

  log.subsection('Missing date detection')
  {
    // Plan is missing Friday
    const plan: HydratedPlanEntry[] = [
      createMockPlanEntry(dates[0], 'm1', createMockMeal('m1', 'Monday', 'poultry')),
      createMockPlanEntry(dates[1], 'm2', createMockMeal('m2', 'Tuesday', 'beef')),
      createMockPlanEntry(dates[2], 'm3', createMockMeal('m3', 'Wednesday', 'fish')),
      createMockPlanEntry(dates[3], 'm4', createMockMeal('m4', 'Thursday', 'pork')),
      // Missing Friday!
      createMockPlanEntry(dates[5], 'm6', createMockMeal('m6', 'Saturday', 'legume')),
      createMockPlanEntry(dates[6], 'm7', createMockMeal('m7', 'Sunday', 'eggs')),
    ]

    const validation = validatePlan(plan, requiredSlots, dates)
    const hasMissing = validation.errors.some((e) => e.type === 'missing_entries')
    results.push({
      name: 'Missing date: detected when plan is missing a day',
      passed: hasMissing && !validation.valid,
      message: hasMissing ? undefined : 'Expected missing_entries error',
    })
  }

  log.subsection('Duplicate date detection')
  {
    // Two entries for Monday
    const plan: HydratedPlanEntry[] = [
      createMockPlanEntry(dates[0], 'm1', createMockMeal('m1', 'Monday A', 'poultry')),
      createMockPlanEntry(dates[0], 'm2', createMockMeal('m2', 'Monday B', 'beef')), // Duplicate date!
      createMockPlanEntry(dates[2], 'm3', createMockMeal('m3', 'Wednesday', 'fish')),
      createMockPlanEntry(dates[3], 'm4', createMockMeal('m4', 'Thursday', 'pork')),
      createMockPlanEntry(dates[4], 'm5', createMockMeal('m5', 'Friday', 'lamb')),
      createMockPlanEntry(dates[5], 'm6', createMockMeal('m6', 'Saturday', 'legume')),
      createMockPlanEntry(dates[6], 'm7', createMockMeal('m7', 'Sunday', 'eggs')),
    ]

    const validation = validatePlan(plan, requiredSlots, dates)
    const hasDuplicateDate = validation.errors.some((e) => e.type === 'duplicate_date')
    results.push({
      name: 'Duplicate date: detected when same date appears twice',
      passed: hasDuplicateDate && !validation.valid,
      message: hasDuplicateDate ? undefined : 'Expected duplicate_date error',
    })
  }

  log.subsection('Invalid meal detection')
  {
    // Meal is null (invalid ID)
    const plan: HydratedPlanEntry[] = [
      createMockPlanEntry(dates[0], 'm1', createMockMeal('m1', 'Monday', 'poultry')),
      { date: dates[1], mealId: 'invalid-id', meal: null }, // Invalid meal!
      createMockPlanEntry(dates[2], 'm3', createMockMeal('m3', 'Wednesday', 'fish')),
      createMockPlanEntry(dates[3], 'm4', createMockMeal('m4', 'Thursday', 'pork')),
      createMockPlanEntry(dates[4], 'm5', createMockMeal('m5', 'Friday', 'lamb')),
      createMockPlanEntry(dates[5], 'm6', createMockMeal('m6', 'Saturday', 'legume')),
      createMockPlanEntry(dates[6], 'm7', createMockMeal('m7', 'Sunday', 'eggs')),
    ]

    const validation = validatePlan(plan, requiredSlots, dates)
    const hasInvalid = validation.errors.some((e) => e.type === 'invalid_meal')
    results.push({
      name: 'Invalid meal: detected when meal is null',
      passed: hasInvalid && !validation.valid,
      message: hasInvalid ? undefined : 'Expected invalid_meal error',
    })
  }

  return results
}

// ============================================
// TEST SUITE: EDGE CASES (Database Integration)
// ============================================

async function testEdgeCases(): Promise<TestResult[]> {
  const results: TestResult[] = []

  log.subsection('Empty candidate pool for fish')
  {
    // Query fish meals with filters that should exclude all
    const fishMeals = await prisma.meal.findMany({
      where: {
        suitableFor: { has: 'dinner' },
        primaryProteinType: 'fish',
      },
    })

    if (fishMeals.length === 0) {
      results.push({
        name: 'Empty fish pool: no fish meals in database',
        passed: true,
        message: 'Database has no fish meals - edge case naturally exists',
      })
    } else {
      // Simulate filtering all fish meals via recent history
      const recentMealIds = fishMeals.map((m) => m.id)
      const filteredFish = await prisma.meal.findMany({
        where: {
          suitableFor: { has: 'dinner' },
          primaryProteinType: 'fish',
          id: { notIn: recentMealIds },
        },
      })

      results.push({
        name: 'Empty fish pool: simulated via recent history exclusion',
        passed: filteredFish.length === 0,
        message:
          filteredFish.length === 0
            ? 'Successfully filtered all fish meals'
            : `${filteredFish.length} fish meals remaining`,
      })
    }
  }

  log.subsection('Allergen filtering excludes all candidates')
  {
    // Get all allergens used in meals
    const mealsWithAllergens = await prisma.meal.findMany({
      where: {
        suitableFor: { has: 'dinner' },
        components: {
          some: {
            ingredient: {
              allergens: { isEmpty: false },
            },
          },
        },
      },
      select: {
        id: true,
        name: true,
        components: {
          select: {
            ingredient: {
              select: { allergens: true },
            },
          },
        },
      },
    })

    // Find which allergens would filter out the most meals
    const allergenCounts: Record<string, number> = {}
    for (const meal of mealsWithAllergens) {
      for (const comp of meal.components) {
        for (const allergen of comp.ingredient.allergens) {
          allergenCounts[allergen] = (allergenCounts[allergen] || 0) + 1
        }
      }
    }

    const allAllergens = Object.keys(allergenCounts) as Allergen[]
    if (allAllergens.length === 0) {
      results.push({
        name: 'Allergen filtering: no allergens in database',
        passed: true,
        message: 'No allergens in database - cannot test allergen filtering',
      })
    } else {
      // Try filtering with all allergens
      const filtered = await prisma.meal.findMany({
        where: {
          suitableFor: { has: 'dinner' },
          NOT: {
            components: {
              some: {
                ingredient: {
                  allergens: { hasSome: allAllergens },
                },
              },
            },
          },
        },
      })

      const totalDinnerMeals = await prisma.meal.count({
        where: { suitableFor: { has: 'dinner' } },
      })

      results.push({
        name: 'Allergen filtering: applying all allergens',
        passed: true,
        message: `${filtered.length}/${totalDinnerMeals} meals remain after filtering all allergens (${allAllergens.join(', ')})`,
      })
    }
  }

  log.subsection('Single candidate scenario')
  {
    // Find protein types with very few meals
    const proteinCounts = await prisma.meal.groupBy({
      by: ['primaryProteinType'],
      where: { suitableFor: { has: 'dinner' } },
      _count: true,
    })

    const singleCandidateTypes = proteinCounts.filter((p) => p._count === 1)
    if (singleCandidateTypes.length > 0) {
      results.push({
        name: 'Single candidate: protein types with only 1 meal',
        passed: true,
        message: `Found ${singleCandidateTypes.length} protein types with single meal: ${singleCandidateTypes.map((p) => p.primaryProteinType).join(', ')}`,
      })
    } else {
      const lowestCount = Math.min(...proteinCounts.map((p) => p._count))
      results.push({
        name: 'Single candidate: check lowest candidate count',
        passed: true,
        message: `Lowest candidate count is ${lowestCount} (no single-meal protein types)`,
      })
    }
  }

  log.subsection('Dietary type filtering')
  {
    // Check vegetarian candidates (no meat)
    const vegetarianMeals = await prisma.meal.count({
      where: {
        suitableFor: { has: 'dinner' },
        primaryProteinType: { notIn: ['poultry', 'beef', 'pork', 'lamb', 'fish'] },
      },
    })

    results.push({
      name: 'Dietary filtering: vegetarian candidate count',
      passed: vegetarianMeals > 0,
      message: `${vegetarianMeals} vegetarian dinner meals available`,
    })

    // Check vegan candidates (no animal products)
    const veganMeals = await prisma.meal.count({
      where: {
        suitableFor: { has: 'dinner' },
        primaryProteinType: { notIn: ['poultry', 'beef', 'pork', 'lamb', 'fish', 'eggs', 'dairy'] },
      },
    })

    results.push({
      name: 'Dietary filtering: vegan candidate count',
      passed: veganMeals > 0,
      message: `${veganMeals} vegan dinner meals available`,
    })

    // Check pescatarian candidates (fish + vegetarian options)
    const pescatarianMeals = await prisma.meal.count({
      where: {
        suitableFor: { has: 'dinner' },
        primaryProteinType: { notIn: ['poultry', 'beef', 'pork', 'lamb'] },
      },
    })

    results.push({
      name: 'Dietary filtering: pescatarian candidate count',
      passed: pescatarianMeals > 0,
      message: `${pescatarianMeals} pescatarian dinner meals available`,
    })
  }

  return results
}

// ============================================
// MAIN EXECUTION
// ============================================

async function main() {
  log.section('BALANCE CONSTRAINTS TEST')
  console.log(`Date: ${new Date().toISOString()}`)

  const allResults: TestResult[] = []

  // Test 1: Slot Computation
  log.section('TEST 1: SLOT COMPUTATION')
  const slotResults = testSlotComputation()
  for (const r of slotResults) {
    if (r.passed) log.pass(r.name)
    else log.fail(r.name, r.message)
  }
  allResults.push(...slotResults)

  // Test 2: Validation Rules
  log.section('TEST 2: VALIDATION RULES')
  const validationResults = testValidationRules()
  for (const r of validationResults) {
    if (r.passed) log.pass(r.name)
    else log.fail(r.name, r.message)
  }
  allResults.push(...validationResults)

  // Test 3: Edge Cases
  log.section('TEST 3: EDGE CASES (Database)')
  const edgeResults = await testEdgeCases()
  for (const r of edgeResults) {
    if (r.passed) log.pass(r.name)
    else log.fail(r.name, r.message)
  }
  allResults.push(...edgeResults)

  // Summary
  log.section('SUMMARY')
  const passed = allResults.filter((r) => r.passed).length
  const failed = allResults.filter((r) => !r.passed).length
  console.log(`\n  Total: ${allResults.length}`)
  console.log(`  Passed: ${passed}`)
  console.log(`  Failed: ${failed}`)
  console.log(`  Pass rate: ${((passed / allResults.length) * 100).toFixed(1)}%`)

  if (failed > 0) {
    console.log('\n  Failed tests:')
    for (const r of allResults.filter((r) => !r.passed)) {
      console.log(`    - ${r.name}${r.message ? `: ${r.message}` : ''}`)
    }
    process.exit(1)
  } else {
    console.log('\n  All tests passed!')
  }
}

main()
  .catch((error) => {
    console.error(`Fatal error: ${error}`)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
