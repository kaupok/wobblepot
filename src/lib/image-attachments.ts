/**
 * Limits for user-attached photos on the "imagine a meal" flows.
 *
 * Shared by the client-side attach control (`@/components/recipes/AttachImages`)
 * and the server-side guard in `/api/meals/imagine`, so the two can't drift.
 * This module is deliberately React-free — the route handler imports it too.
 */

export const MAX_ATTACHED_IMAGES = 3

export const MAX_ATTACHED_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** Value for the file input's `accept` attribute, derived from the allow-list. */
export const IMAGE_ACCEPT_ATTRIBUTE = ALLOWED_IMAGE_TYPES.join(',')

/**
 * Why a batch of files was rejected, or `null` when the batch is acceptable.
 * Callers map the reason to a localized message — this module stays copy-free
 * so both locales and both call sites can share it.
 */
export type ImageAttachmentRejection = 'too-many' | 'wrong-type' | 'too-large'

/**
 * Validate a batch of newly-selected files against the attachment limits.
 *
 * @param files - The files just selected.
 * @param alreadyAttached - How many files are already attached (counts toward the max).
 */
export function validateImageAttachments(
  files: Pick<File, 'type' | 'size'>[],
  alreadyAttached = 0,
): ImageAttachmentRejection | null {
  if (alreadyAttached + files.length > MAX_ATTACHED_IMAGES) {
    return 'too-many'
  }

  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return 'wrong-type'
    }
    if (file.size > MAX_ATTACHED_IMAGE_SIZE) {
      return 'too-large'
    }
  }

  return null
}
