/**
 * Shrink an attached photo in the browser before upload.
 *
 * Vercel rejects a request body over 4.5 MB with a 413 before the route runs,
 * but a phone photo alone can be 5 MB, and a request carries up to three
 * (`MAX_ATTACHED_IMAGES`). Claude reads images at about 1568 px on the long
 * edge, so a larger photo costs upload size and gains nothing (HON-1274).
 *
 * Browser-only: it draws to a canvas. Where that cannot run (no
 * `createImageBitmap`, a decode error), it returns the original file, so the
 * upload still goes ahead and the server's own checks apply.
 */

/** The long edge Claude's vision input is sized to. */
export const DOWNSCALE_MAX_EDGE = 1568

/** A photo at or under this size is sent as it is. */
export const DOWNSCALE_SKIP_BYTES = 1024 * 1024

const JPEG_QUALITY = 0.85

export async function downscaleImage(file: File): Promise<File> {
  if (file.size <= DOWNSCALE_SKIP_BYTES) return file
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file

  try {
    // `createImageBitmap` applies the EXIF orientation, so a portrait phone
    // photo stays upright after the redraw.
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, DOWNSCALE_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      bitmap.close()
      return file
    }
    // JPEG has no alpha: a transparent PNG screenshot would turn black.
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    )
    if (!blob || blob.size >= file.size) return file

    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified })
  } catch {
    return file
  }
}
