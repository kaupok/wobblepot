import { MAX_ATTACHED_IMAGES, validateImageAttachments } from '@/lib/image-attachments'

/** A validated photo, ready for an AI image part. */
export interface EncodedImage {
  base64: string
  mimeType: string
}

/** The error codes a bad batch of photos returns, shared by every route that takes them. */
export type ImageAttachmentErrorCode = 'too_many_images' | 'wrong_image_type' | 'image_too_large'

export type ReadImageAttachmentsResult =
  | { ok: true; images: EncodedImage[] }
  | { ok: false; error: string; code: ImageAttachmentErrorCode }

/**
 * Read the `image` fields of a multipart body, validate them against the
 * attachment limits, and encode each as base64.
 *
 * Used by `/api/meals/imagine` and `/api/recipes/parse`, so both routes count,
 * reject and encode photos the same way. The `error` string is English, for
 * logs; clients render copy from `code`.
 */
export async function readImageAttachments(
  formData: FormData,
): Promise<ReadImageAttachmentsResult> {
  const imageFields = formData.getAll('image')
  const imageFiles = imageFields.filter((file) => file instanceof File)

  // Non-File entries can't be encoded, so they're skipped — but they still
  // occupy a slot against the cap, which is how these endpoints have always
  // counted them. Passing the difference as `alreadyAttached` keeps that.
  const rejection = validateImageAttachments(imageFiles, imageFields.length - imageFiles.length)
  if (rejection === 'too-many') {
    return {
      ok: false,
      error: `Maximum ${MAX_ATTACHED_IMAGES} images allowed`,
      code: 'too_many_images',
    }
  }
  if (rejection === 'wrong-type') {
    return { ok: false, error: 'Images must be JPEG, PNG, or WebP', code: 'wrong_image_type' }
  }
  if (rejection === 'too-large') {
    return { ok: false, error: 'Each image must be 5MB or less', code: 'image_too_large' }
  }

  const images: EncodedImage[] = []
  for (const file of imageFiles) {
    const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')
    images.push({ base64, mimeType: file.type })
  }
  return { ok: true, images }
}
