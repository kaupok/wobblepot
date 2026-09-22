import 'server-only'
import type { MealImageStatus } from '@/generated/prisma/enums'
import { MEAL_IMAGE_PROMPT_VERSION } from '@/lib/meal-images/prompt'

type StoredMealImage = {
  imageStatus: MealImageStatus
  imageUrl: string | null
  imageHue: number | null
  imagePromptVersion: string | null
}

export type PresentedMealImage = Pick<StoredMealImage, 'imageStatus' | 'imageUrl' | 'imageHue'>

/**
 * The image fields a meal payload sends to the client (HON-753).
 *
 * An image drawn at an older prompt version is presented as absent: it has no
 * hue (every pre-HON-744 image), so the card could not tint itself around it,
 * and `useMealImage` only POSTs for a meal with no image — which is what gets
 * a household meal redrawn at the current version. Every serializer that
 * sends image fields goes through this, so no payload shows a stale image.
 */
export function presentMealImage(meal: StoredMealImage): PresentedMealImage {
  if (meal.imageStatus === 'ready' && meal.imagePromptVersion !== MEAL_IMAGE_PROMPT_VERSION) {
    return { imageStatus: 'none', imageUrl: null, imageHue: null }
  }
  return { imageStatus: meal.imageStatus, imageUrl: meal.imageUrl, imageHue: meal.imageHue }
}
