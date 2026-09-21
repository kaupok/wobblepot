import 'server-only'
import { del, put } from '@vercel/blob'
import { captureApiError } from '@/lib/errors'

/**
 * Vercel Blob storage for generated meal illustrations (HON-734).
 *
 * Credentials are never passed in: since `@vercel/blob` 2.x the SDK reads
 * `VERCEL_OIDC_TOKEN` + `BLOB_STORE_ID` (or a static `BLOB_READ_WRITE_TOKEN`)
 * from the environment itself. See docs/ENVIRONMENT_SETUP.md § "Vercel Blob".
 */

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/**
 * Upload a meal image and return its public URL. The SDK appends a random
 * suffix, so the stored pathname is `meals/{mealId}-{suffix}.{ext}` — a
 * regenerated image never reuses the URL a CDN may still be caching.
 */
export async function putMealImage(
  mealId: string,
  bytes: Buffer,
  mediaType: string,
): Promise<string> {
  const extension = EXTENSIONS[mediaType]
  if (!extension) {
    throw new Error(`Unsupported meal image media type: ${mediaType}`)
  }

  const blob = await put(`meals/${mealId}.${extension}`, bytes, {
    access: 'public',
    addRandomSuffix: true,
    contentType: mediaType,
  })

  return blob.url
}

/** Delete a meal image by its public URL. Throws on failure. */
export async function deleteMealImage(url: string): Promise<void> {
  await del(url)
}

/**
 * Best-effort delete for the invalidation paths, run after the transaction
 * that cleared the columns has committed. An orphaned file is harmless, so a
 * failure is reported and swallowed — it must never fail the meal edit or
 * delete that triggered it.
 */
export async function discardMealImage(url: string | null, route: string): Promise<void> {
  if (!url) return

  try {
    await deleteMealImage(url)
  } catch (error) {
    captureApiError(error, { route, operation: 'meal-image-delete' })
  }
}
