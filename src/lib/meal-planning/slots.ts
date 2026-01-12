import { DietaryType, ProteinType } from '@/generated/prisma/enums'

export interface SlotRequirement {
  date: Date
  proteinType: ProteinType
}

type SlotType = 'midweek' | 'weekend' | 'early' | 'late'

const dayOfWeekMap: Record<SlotType, number> = {
  midweek: 3, // Wednesday
  weekend: 6, // Saturday
  early: 2, // Tuesday
  late: 5, // Friday
}

/**
 * Pick a day from the dates array matching the slot type.
 * Falls back to first date if target day not found.
 * Requires non-empty dates array.
 */
export function pickDay(dates: Date[], slot: SlotType): Date {
  if (dates.length === 0) {
    throw new Error('pickDay requires non-empty dates array')
  }
  const targetDay = dayOfWeekMap[slot]
  return dates.find((d) => d.getDay() === targetDay) ?? dates[0]!
}

/**
 * Compute required protein type slots based on dietary type.
 * These slots ensure nutritional variety in the meal plan.
 *
 * Logic by dietary type:
 * - omnivore: fish 1x/week (midweek), legume 1x/week (weekend)
 * - pescatarian: fish 2x/week (early + late), legume 1x/week (midweek)
 * - vegetarian: legume 2x/week (early + late)
 * - vegan: legume 2x/week (early + late)
 */
export function computeRequiredSlots(dietaryType: DietaryType, dates: Date[]): SlotRequirement[] {
  if (dates.length === 0) {
    return []
  }

  switch (dietaryType) {
    case 'omnivore':
      return [
        { date: pickDay(dates, 'midweek'), proteinType: 'fish' },
        { date: pickDay(dates, 'weekend'), proteinType: 'legume' },
      ]

    case 'pescatarian':
      return [
        { date: pickDay(dates, 'early'), proteinType: 'fish' },
        { date: pickDay(dates, 'late'), proteinType: 'fish' },
        { date: pickDay(dates, 'midweek'), proteinType: 'legume' },
      ]

    case 'vegetarian':
    case 'vegan':
      return [
        { date: pickDay(dates, 'early'), proteinType: 'legume' },
        { date: pickDay(dates, 'late'), proteinType: 'legume' },
      ]
  }
}
