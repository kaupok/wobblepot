// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { MAX_ATTACHED_IMAGE_SIZE } from './image-attachments'
import { readImageAttachments } from './image-attachments-server'

function form(...entries: (File | string)[]) {
  const formData = new FormData()
  for (const entry of entries) formData.append('image', entry)
  return formData
}

const jpeg = (bytes = 'jpeg-bytes') => new File([bytes], 'a.jpg', { type: 'image/jpeg' })

describe('readImageAttachments', () => {
  it('returns no images for a form with no image field', async () => {
    expect(await readImageAttachments(new FormData())).toEqual({ ok: true, images: [] })
  })

  it('encodes each photo as base64 with its MIME type', async () => {
    const png = new File(['png-bytes'], 'b.png', { type: 'image/png' })
    expect(await readImageAttachments(form(jpeg(), png))).toEqual({
      ok: true,
      images: [
        { base64: Buffer.from('jpeg-bytes').toString('base64'), mimeType: 'image/jpeg' },
        { base64: Buffer.from('png-bytes').toString('base64'), mimeType: 'image/png' },
      ],
    })
  })

  it('rejects more than 3 photos as too_many_images', async () => {
    const result = await readImageAttachments(form(jpeg(), jpeg(), jpeg(), jpeg()))
    expect(result).toEqual({
      ok: false,
      error: 'Maximum 3 images allowed',
      code: 'too_many_images',
    })
  })

  it('counts a non-file image field against the cap', async () => {
    const result = await readImageAttachments(form(jpeg(), jpeg(), jpeg(), 'not-a-file'))
    expect(result).toMatchObject({ ok: false, code: 'too_many_images' })
  })

  it('rejects a file that is not JPEG, PNG or WebP as wrong_image_type', async () => {
    const gif = new File(['gif'], 'c.gif', { type: 'image/gif' })
    expect(await readImageAttachments(form(gif))).toMatchObject({
      ok: false,
      code: 'wrong_image_type',
    })
  })

  it('rejects a photo over 5 MB as image_too_large', async () => {
    const result = await readImageAttachments(form(jpeg('x'.repeat(MAX_ATTACHED_IMAGE_SIZE + 1))))
    expect(result).toMatchObject({ ok: false, code: 'image_too_large' })
  })
})
