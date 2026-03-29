import { DietaryType, MealType, ProteinType } from '@/generated/prisma/enums'

/**
 * A meal slot representing a specific date and meal type combination.
 */
export interface MealSlot {
  date: Date
  mealType: MealType
}

/**
 * A slot requirement specifying protein type constraints for a meal slot.
 * Only dinner slots have protein balance requirements.
 */
export interface SlotRequirement {
  date: Date
  mealType: MealType
  proteinType: ProteinType
}

type SlotType = 'midweek' | 'weekend' | 'early' | 'late'

/**
 * Relative positions within a date range for protein balance slots.
 * Values are fractions (0-1) of the range length.
 * For a 7-day range: early≈day 2, midweek≈day 3, late≈day 5, weekend≈day 6.
 */
const relativePositionMap: Record<SlotType, number> = {
  early: 0.25,
  midweek: 0.4,
  late: 0.7,
  weekend: 0.8,
}

/**
 * Minimum number of days required to enforce balance constraints.
 * Below this threshold, we relax protein type requirements.
 */
const MIN_DAYS_FOR_BALANCE = 5

/**
 * Check if balance constraints should be enforced for a given number of days.
 * Returns true if we have enough days for meaningful variety.
 */
export function shouldEnforceBalanceConstraints(dateCount: number): boolean {
  return dateCount >= MIN_DAYS_FOR_BALANCE
}

/**
 * Check if a date is a weekday (Monday-Friday).
 */
function isWeekday(date: Date): boolean {
  const day = date.getDay()
  return day >= 1 && day <= 5
}

/**
 * Expand dates into meal slots based on meal type preferences.
 * Each date becomes one or more slots depending on configured meal types.
 *
 * @param dates - Array of dates to expand
 * @param weekdayMealTypes - Meal types for Monday-Friday
 * @param weekendMealTypes - Meal types for Saturday-Sunday
 * @returns Array of meal slots (date + mealType combinations)
 */
export function computeMealSlots(
  dates: Date[],
  weekdayMealTypes: MealType[],
  weekendMealTypes: MealType[],
): MealSlot[] {
  const slots: MealSlot[] = []

  for (const date of dates) {
    const mealTypes = isWeekday(date) ? weekdayMealTypes : weekendMealTypes

    for (const mealType of mealTypes) {
      slots.push({ date, mealType })
    }
  }

  return slots
}

/**
 * Pick a day from the dates array at a relative position for the slot type.
 * Uses fractional positions within the range for flexible date range support.
 * Requires non-empty dates array.
 */
export function pickDay(dates: Date[], slot: SlotType): Date {
  if (dates.length === 0) {
    throw new Error('pickDay requires non-empty dates array')
  }
  const position = relativePositionMap[slot]
  const index = Math.min(Math.round(position * (dates.length - 1)), dates.length - 1)
  return dates[index]!
}

/**
 * Options for computing required protein type slots.
 */
export interface ComputeRequiredSlotsOptions {
  dietaryType: DietaryType | null
  dates: Date[]
  weekdayMealTypes: MealType[]
  weekendMealTypes: MealType[]
}

/**
 * Compute required protein type slots based on dietary type.
 * These slots ensure nutritional variety in the meal plan.
 *
 * Logic by dietary type:
 * - null (no preference): fish 1x/week (midweek), legume 1x/week (weekend)
 * - pescatarian: fish 2x/week (early + late), legume 1x/week (midweek)
 * - vegetarian: legume 2x/week (early + late)
 * - vegan: legume 2x/week (early + late)
 *
 * Balance constraints only apply to dinner slots.
 * For partial weeks (<5 dinner days), returns empty array to relax constraints.
 */
export function computeRequiredSlots(options: ComputeRequiredSlotsOptions): SlotRequirement[] {
  const { dietaryType, dates, weekdayMealTypes, weekendMealTypes } = options

  if (dates.length === 0) {
    return []
  }

  // Filter to dates that have dinner meals
  const dinnerDates = dates.filter((date) => {
    const mealTypes = isWeekday(date) ? weekdayMealTypes : weekendMealTypes
    return mealTypes.includes('dinner')
  })

  // Relax constraints for partial weeks
  if (!shouldEnforceBalanceConstraints(dinnerDates.length)) {
    return []
  }

  if (dietaryType === null) {
    // No preference: fish 1x/week (midweek), legume 1x/week (weekend)
    return [
      { date: pickDay(dinnerDates, 'midweek'), mealType: 'dinner', proteinType: 'fish' },
      { date: pickDay(dinnerDates, 'weekend'), mealType: 'dinner', proteinType: 'legume' },
    ]
  }

  switch (dietaryType) {
    case 'pescatarian':
      return [
        { date: pickDay(dinnerDates, 'early'), mealType: 'dinner', proteinType: 'fish' },
        { date: pickDay(dinnerDates, 'late'), mealType: 'dinner', proteinType: 'fish' },
        { date: pickDay(dinnerDates, 'midweek'), mealType: 'dinner', proteinType: 'legume' },
      ]

    case 'vegetarian':
    case 'vegan':
      return [
        { date: pickDay(dinnerDates, 'early'), mealType: 'dinner', proteinType: 'legume' },
        { date: pickDay(dinnerDates, 'late'), mealType: 'dinner', proteinType: 'legume' },
      ]

    default: {
      const _exhaustive: never = dietaryType
      throw new Error(`Unhandled dietary type: ${_exhaustive}`)
    }
  }
}
