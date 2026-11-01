import mealIllustration from '@/stories/assets/meal-illustration-white.png'
import { createMealCardBaseData } from '@/stories/fixtures'

import type { MealCardBaseData } from './MealCardBase'

/** A meal with a ready image and the given hue, for the `MealImageCard` stories. */
export const withImage = (hue: number, overrides: Partial<MealCardBaseData> = {}) =>
  createMealCardBaseData({
    imageStatus: 'ready',
    imageUrl: mealIllustration.src,
    imageHue: hue,
    ...overrides,
  })
