import type { Prisma } from '@/generated/prisma/client'

/** Column values for a meal with no image — the schema defaults. */
export const MEAL_IMAGE_CLEARED = {
  imageUrl: null,
  imagePromptVersion: null,
  imageStatus: 'none',
  imageClaimedAt: null,
  imageAttempts: 0,
  imageHue: null,
} as const satisfies Prisma.MealUpdateInput

/**
 * Reset a meal's image columns and return the URL it pointed at, so the
 * caller can delete the blob once the transaction commits (deleting inside it
 * would lose the file if the transaction then rolled back).
 *
 * Call it wherever the meal's content — name, description, components or
 * `preparationNotes` — changes, since the illustration depicts that content.
 * It clears unconditionally, including a row that is mid-`generating`: the
 * generation route (HON-735) owns noticing that its claim was reset.
 */
export async function clearMealImage(
  tx: Prisma.TransactionClient,
  mealId: string,
): Promise<string | null> {
  const { imageUrl } = await tx.meal.findUniqueOrThrow({
    where: { id: mealId },
    select: { imageUrl: true },
  })

  await tx.meal.update({
    where: { id: mealId },
    data: MEAL_IMAGE_CLEARED,
  })

  return imageUrl
}
