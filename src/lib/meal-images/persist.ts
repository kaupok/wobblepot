import 'server-only'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { visibleMealWhere } from '@/lib/meals/load-meals'
import { presentMealImage, type PresentedMealImage } from '@/lib/meal-images/present'
import { MEAL_IMAGE_PROMPT_VERSION } from '@/lib/meal-images/prompt'
import type { VesselEstimate } from '@/lib/meal-images/vessel'

/**
 * The reads and writes around lazy meal image generation, behind `GET` and
 * `POST /api/meals/[id]/image` (HON-735, HON-1211). The route owns the
 * session, the household, flags, rate limits, the AI call, storage and the
 * status map; these functions own every query, and are tested against a
 * database in `persist.db.test.ts`.
 *
 * A generation takes a claim on the row first (`claimMealImage`), and every
 * later write is guarded on that claim, so an edit or a takeover while the
 * image is drawn makes the write match nothing.
 */

/** A meal whose image failed this many times is never retried. */
export const MEAL_IMAGE_MAX_ATTEMPTS = 3

/**
 * A `generating` claim older than this belongs to a function that died: the
 * route's `maxDuration` kills every live one well before it.
 */
export const MEAL_IMAGE_CLAIM_STALE_MS = 3 * 60_000

/** The meal as the generation reads it: its content, and its image state. */
export async function loadMealForImage(householdId: string, mealId: string) {
  return prisma.meal.findFirst({
    where: { id: mealId, ...visibleMealWhere(householdId) },
    select: {
      id: true,
      name: true,
      description: true,
      preparationNotes: true,
      householdId: true,
      updatedAt: true,
      imageUrl: true,
      imageStatus: true,
      imageHue: true,
      imagePromptVersion: true,
      imageClaimedAt: true,
      imageAttempts: true,
      components: {
        select: {
          quantityPerServing: true,
          ingredient: {
            select: { name: true, defaultUnit: true, gramsPerPiece: true, densityGPerMl: true },
          },
        },
      },
    },
  })
}

export type MealForImage = NonNullable<Awaited<ReturnType<typeof loadMealForImage>>>

/**
 * The stored image state of a meal the household can see, as every meal
 * payload presents it: a `ready` image at an older prompt version reads as
 * `none` (HON-753). Null when the household cannot see the meal.
 */
export async function readMealImage(
  householdId: string,
  mealId: string,
): Promise<PresentedMealImage | null> {
  const meal = await prisma.meal.findFirst({
    where: { id: mealId, ...visibleMealWhere(householdId) },
    select: { imageUrl: true, imageStatus: true, imageHue: true, imagePromptVersion: true },
  })
  return meal ? presentMealImage(meal) : null
}

/** A held claim on a meal's image columns. Every write after the claim takes it. */
export interface ImageClaim {
  mealId: string
  claimedAt: Date
  /** The `updatedAt` the meal's content was read at. */
  updatedAt: Date
  /** True when the claim took a `ready` row at a stale prompt version (HON-753). */
  redraw: boolean
}

/**
 * Claims the meal's image for one generation, so two households opening the
 * same meal never both pay. Null when the row no longer matches: another
 * request holds a live claim, the image failed `MEAL_IMAGE_MAX_ATTEMPTS`
 * times, or the meal was edited or deleted since `meal` was read.
 *
 * `updatedAt` is pinned for two reasons: the content was read at that
 * version, so an edit since then must not be drawn from the stale read; and
 * writing it back keeps this claim from moving it (see `writeUnderClaim`).
 *
 * A `ready` row only reaches here at a stale prompt version. Its claim pins
 * the version read, and resets the attempts: a new prompt is a new image,
 * owed the full `MEAL_IMAGE_MAX_ATTEMPTS`.
 */
export async function claimMealImage(
  meal: Pick<MealForImage, 'id' | 'updatedAt' | 'imageStatus' | 'imagePromptVersion'>,
  now: Date,
): Promise<ImageClaim | null> {
  const staleBefore = new Date(now.getTime() - MEAL_IMAGE_CLAIM_STALE_MS)
  const redraw = meal.imageStatus === 'ready'
  const { count } = await prisma.meal.updateMany({
    where: {
      id: meal.id,
      deletedAt: null,
      updatedAt: meal.updatedAt,
      OR: redraw
        ? [{ imageStatus: 'ready', imagePromptVersion: meal.imagePromptVersion }]
        : [
            { imageStatus: 'none' },
            { imageStatus: 'failed', imageAttempts: { lt: MEAL_IMAGE_MAX_ATTEMPTS } },
            // A crashed function never releases its claim.
            { imageStatus: 'generating', imageClaimedAt: { lt: staleBefore } },
            { imageStatus: 'generating', imageClaimedAt: null },
          ],
    },
    data: {
      imageStatus: 'generating',
      imageClaimedAt: now,
      updatedAt: meal.updatedAt,
      ...(redraw ? { imageAttempts: 0 } : {}),
    },
  })
  return count > 0 ? { mealId: meal.id, claimedAt: now, updatedAt: meal.updatedAt, redraw } : null
}

/**
 * Write image columns only while the claim still holds.
 *
 * `clearMealImage` (HON-734) resets `imageClaimedAt` whenever the meal's
 * content is edited, even mid-generation, and a stale-claim takeover replaces
 * it — so matching on it is how a generation notices either.
 *
 * The first attempt also pins `updatedAt` and writes the same value back.
 * Prisma's `@updatedAt` would otherwise move on every image write, and the
 * prep-tips route guards its own cache write on `Meal.updatedAt` (HON-683):
 * the modal opens both at once, so a bump here would silently throw away the
 * freshly generated tips. If some other edit already moved `updatedAt`, the
 * fallback writes normally — rolling it back would re-open that guard.
 */
async function writeUnderClaim(
  claim: ImageClaim,
  data: Prisma.MealUpdateManyMutationInput,
): Promise<boolean> {
  const pinned = await prisma.meal.updateMany({
    where: { id: claim.mealId, imageClaimedAt: claim.claimedAt, updatedAt: claim.updatedAt },
    data: { ...data, updatedAt: claim.updatedAt },
  })
  if (pinned.count > 0) return true

  const moved = await prisma.meal.updateMany({
    where: { id: claim.mealId, imageClaimedAt: claim.claimedAt },
    data,
  })
  return moved.count > 0
}

/**
 * Attaches a generated image at the current prompt version, with its hue and
 * vessel estimate. False when the claim was lost (the meal was edited, or the
 * claim taken over): the image shows old content and must not be attached.
 */
export function attachMealImage(
  claim: ImageClaim,
  image: { url: string; hue: number | null; vessel: VesselEstimate | null },
): Promise<boolean> {
  return writeUnderClaim(claim, {
    imageStatus: 'ready',
    imageUrl: image.url,
    imagePromptVersion: MEAL_IMAGE_PROMPT_VERSION,
    imageHue: image.hue,
    // Stored so a refit reuses it rather than asking again (HON-1034).
    imageVessel: image.vessel?.vessel ?? null,
    imageDiameterCm: image.vessel?.diameterCm ?? null,
  })
}

/**
 * Gives the claim back without counting an attempt, after a provider rate
 * limit (HON-742): to `none`, or for a stale-version redraw back to the
 * `ready` row it claimed, which still points at the old blob.
 */
export function releaseMealImageClaim(claim: ImageClaim): Promise<boolean> {
  return writeUnderClaim(claim, {
    imageStatus: claim.redraw ? 'ready' : 'none',
    imageClaimedAt: null,
  })
}

/**
 * Marks the image failed. `countAttempt` is false for a failure that says
 * nothing about this meal (no key, an exhausted quota), so busy moments never
 * lock it out.
 */
export function markMealImageFailed(
  claim: ImageClaim,
  { countAttempt }: { countAttempt: boolean },
): Promise<boolean> {
  return writeUnderClaim(claim, {
    imageStatus: 'failed',
    ...(countAttempt ? { imageAttempts: { increment: 1 } } : {}),
  })
}
