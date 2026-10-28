import 'server-only'
import { serverEnv } from '@/lib/env'
import { checkRateLimit } from '@/lib/rate-limit'
import { getServerFlag } from '@/lib/feature-flags'
import { AiCostCapExceededError, assertUnderCap, recordAiUsage } from '@/lib/ai/usage'
import { aiErrorStatusCode } from '@/lib/ai/error-status'
import { captureApiError } from '@/lib/errors'
import { extractHue } from '@/lib/meal-images/colour'
import {
  generateMealImage,
  isQuotaExhausted,
  isRateLimited,
  MealImageUnavailableError,
} from '@/lib/meal-images/generate'
import {
  attachMealImage,
  claimMealImage,
  loadMealForImage,
  markMealImageFailed,
  releaseMealImageClaim,
  type ImageClaim,
  type MealForImage,
} from '@/lib/meal-images/persist'
import { discardMealImage, putMealImage } from '@/lib/meal-images/storage'

/**
 * Drawing a household meal's image once its claim is held (HON-735), shared
 * by the two ways one starts: `POST /api/meals/[id]/image` when the cook view
 * opens, and saving or editing a recipe (HON-1364), which claims in the
 * request and draws in `after()`.
 */

/**
 * Wall-clock budget for all AI time in one draw, in ms: two images and two
 * judge calls in the worst case (~43 s measured), and `generateMealImage`
 * only starts the second image when the budget still has room for it. The
 * remaining 10 s under the callers' `maxDuration` of 60 covers the Blob
 * upload and the DB writes after it (HON-694, HON-699).
 */
const AI_BUDGET_MS = 50_000

/**
 * A provider 429 is waited out at most once here, for at most 15 s: longer,
 * and the image after it no longer fits `AI_BUDGET_MS` (HON-742). A 429 that
 * outlasts it releases the claim instead of failing the meal.
 */
const RATE_LIMIT_RETRIES = 1
const RATE_LIMIT_MAX_WAIT_MS = 15_000

/** Who a draw is for, and where it is logged from. */
export interface DrawContext {
  householdId: string
  userId: string
  route: string
}

/**
 * How a draw ended. `lost` means the claim was taken while it drew (the meal
 * was edited, or a stale claim taken over), so the image was thrown away.
 * `error` has already been logged and written to the row; the fields say how
 * a route maps it to a status.
 */
export type DrawOutcome =
  | { kind: 'ready'; imageUrl: string; imageHue: number | null }
  | { kind: 'lost' }
  | {
      kind: 'error'
      error: unknown
      statusCode: number | undefined
      rateLimited: boolean
      unavailable: boolean
    }

/**
 * The meal's card hue from the image bytes (HON-744). A failure is logged and
 * stored as null, never raised: an image that was generated and paid for must
 * not be thrown away over its colour.
 */
async function hueOf(bytes: Uint8Array, mealId: string, route: string): Promise<number | null> {
  try {
    return (await extractHue(bytes)).hue
  } catch (error) {
    captureApiError(error, { route, operation: 'meal-image-hue', mealId })
    return null
  }
}

/**
 * Generates, uploads and attaches the image for a held claim, recording the
 * AI spend on the household. On failure it logs the error, deletes an
 * uploaded blob, and releases the claim (a provider rate limit) or marks the
 * image failed. It never throws.
 */
export async function drawClaimedMealImage(
  meal: MealForImage,
  claim: ImageClaim,
  { householdId, userId, route }: DrawContext,
): Promise<DrawOutcome> {
  let uploadedUrl: string | null = null

  try {
    const image = await generateMealImage(
      {
        name: meal.name,
        description: meal.description,
        preparationNotes: meal.preparationNotes,
        components: meal.components.map((c) => ({
          name: c.ingredient.name,
          quantity: c.quantityPerServing,
          unit: c.ingredient.defaultUnit,
          gramsPerPiece: c.ingredient.gramsPerPiece,
          densityGPerMl: c.ingredient.densityGPerMl,
        })),
      },
      {
        abortSignal: AbortSignal.timeout(AI_BUDGET_MS),
        budgetMs: AI_BUDGET_MS,
        rateLimitRetries: RATE_LIMIT_RETRIES,
        maxRateLimitWaitMs: RATE_LIMIT_MAX_WAIT_MS,
        mealId: meal.id,
        onUsage: (usage) => recordAiUsage({ householdId, feature: 'meal_image', ...usage }),
      },
    )

    uploadedUrl = await putMealImage(meal.id, Buffer.from(image.bytes), image.mediaType)
    const imageHue = await hueOf(image.bytes, meal.id, route)

    const attached = await attachMealImage(claim, {
      url: uploadedUrl,
      hue: imageHue,
      vessel: image.vessel,
    })

    if (!attached) {
      // The meal was edited (or the claim taken over) while we generated: this
      // image shows the old ingredients, so it must never be attached.
      await discardMealImage(uploadedUrl, route)
      return { kind: 'lost' }
    }

    // The image this one replaced — a stale-version redraw, or a stale claim
    // over one. Deleted only now it is detached, as `clearMealImage` orders it;
    // until then the row still points at it, so a failure orphans nothing.
    if (meal.imageUrl && meal.imageUrl !== uploadedUrl) {
      await discardMealImage(meal.imageUrl, route)
    }

    return { kind: 'ready', imageUrl: uploadedUrl, imageHue }
  } catch (error) {
    captureApiError(error, { route, userId, feature: 'meal_image', householdId })

    // Only reached before the image was attached, so an uploaded blob is an orphan.
    await discardMealImage(uploadedUrl, route)

    const statusCode = aiErrorStatusCode(error)
    const rateLimited = isRateLimited(error)
    const unavailable = error instanceof MealImageUnavailableError || isQuotaExhausted(error)
    // A 429, an exhausted quota or a missing key says nothing about this meal,
    // and retrying later succeeds — counting it would lock the meal out after
    // three busy moments. Everything else counts: it was probably billed, or
    // will fail again.
    // A rate limit goes further and releases the claim, so the next open
    // simply asks again once the provider's per-minute window clears
    // (HON-742).
    const transient = statusCode === 429 || unavailable

    try {
      if (rateLimited) {
        await releaseMealImageClaim(claim)
      } else {
        await markMealImageFailed(claim, { countAttempt: !transient })
      }
    } catch (writeError) {
      // The stale-claim takeover recovers the row; the original error is the one to map.
      captureApiError(writeError, { route, operation: 'meal-image-mark-failed' })
    }

    return { kind: 'error', error, statusCode, rateLimited, unavailable }
  }
}

/** A claim taken while a recipe is saved, for `drawSavedMealImage` to draw. */
export interface SavedMealImageClaim {
  meal: MealForImage
  claim: ImageClaim
}

/**
 * Claims a just-saved household recipe's image inside the save request
 * (HON-1364), so the list read after the save already shows it `generating`.
 * Null when images are off (no OpenAI key) or the claim is not won; the cook
 * view then draws it on open, as before.
 *
 * Only the claim runs here. The rate limit, the kill-switch and the AI cap
 * are checked by `drawSavedMealImage` after the response, so saving is not
 * slower. Never throws: the recipe is already saved, so a failed claim is
 * logged and the save still answers with it.
 */
export async function claimSavedMealImage(
  householdId: string,
  mealId: string,
  route: string,
): Promise<SavedMealImageClaim | null> {
  if (!serverEnv.OPENAI_API_KEY) return null

  try {
    const meal = await loadMealForImage(householdId, mealId)
    // A save only ever writes a household recipe; a global one is the batch's.
    if (!meal || meal.householdId === null) return null

    const claim = await claimMealImage(meal, new Date())
    return claim ? { meal, claim } : null
  } catch (error) {
    captureApiError(error, { route, operation: 'meal-image-claim', householdId, mealId })
    return null
  }
}

/**
 * Draws a saved recipe's image after the save response (`after()`), behind
 * the same gates as `POST /api/meals/[id]/image`. A gate that says no gives
 * the claim back, so the recipe reads `none` and the cook view can ask again
 * later. Never throws: a failure is logged and leaves the recipe without an
 * image.
 */
export async function drawSavedMealImage(
  { meal, claim }: SavedMealImageClaim,
  context: DrawContext,
): Promise<void> {
  const { householdId, userId, route } = context

  try {
    const allowed =
      (await checkRateLimit(householdId, 'meal-image')).allowed &&
      (await getServerFlag('ai_generation_enabled', userId)) &&
      (await underCap(householdId))

    if (!allowed) {
      await releaseMealImageClaim(claim)
      return
    }
  } catch (error) {
    captureApiError(error, { route, userId, feature: 'meal_image', householdId })
    await releaseMealImageClaim(claim).catch((releaseError: unknown) =>
      captureApiError(releaseError, { route, operation: 'meal-image-release' }),
    )
    return
  }

  await drawClaimedMealImage(meal, claim, context)
}

async function underCap(householdId: string): Promise<boolean> {
  try {
    await assertUnderCap(householdId)
    return true
  } catch (error) {
    if (error instanceof AiCostCapExceededError) return false
    throw error
  }
}
