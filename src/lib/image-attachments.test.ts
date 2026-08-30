import { describe, it, expect } from 'vitest'
import {
  ALLOWED_IMAGE_TYPES,
  IMAGE_ACCEPT_ATTRIBUTE,
  MAX_ATTACHED_IMAGES,
  MAX_ATTACHED_IMAGE_SIZE,
  validateImageAttachments,
} from './image-attachments'

const file = (type: string, size = 1_000) => ({ type, size })

describe('image attachment limits', () => {
  it('derives the accept attribute from the allow-list', () => {
    expect(IMAGE_ACCEPT_ATTRIBUTE).toBe(ALLOWED_IMAGE_TYPES.join(','))
    expect(IMAGE_ACCEPT_ATTRIBUTE).toBe('image/jpeg,image/png,image/webp')
  })

  it('allows at most 3 images of at most 5MB', () => {
    expect(MAX_ATTACHED_IMAGES).toBe(3)
    expect(MAX_ATTACHED_IMAGE_SIZE).toBe(5 * 1024 * 1024)
  })
})

describe('validateImageAttachments', () => {
  it('accepts a batch within every limit', () => {
    expect(validateImageAttachments([file('image/jpeg'), file('image/png')])).toBeNull()
  })

  it('accepts an empty batch', () => {
    expect(validateImageAttachments([])).toBeNull()
  })

  it('rejects a batch that exceeds the count limit', () => {
    expect(
      validateImageAttachments([file('image/jpeg'), file('image/jpeg'), file('image/jpeg')], 1),
    ).toBe('too-many')
  })

  it('counts already-attached files toward the limit', () => {
    expect(validateImageAttachments([file('image/jpeg')], MAX_ATTACHED_IMAGES)).toBe('too-many')
    expect(validateImageAttachments([file('image/jpeg')], MAX_ATTACHED_IMAGES - 1)).toBeNull()
  })

  it('rejects a disallowed mime type', () => {
    expect(validateImageAttachments([file('image/gif')])).toBe('wrong-type')
    expect(validateImageAttachments([file('application/pdf')])).toBe('wrong-type')
  })

  it('accepts every allowed mime type', () => {
    for (const type of ALLOWED_IMAGE_TYPES) {
      expect(validateImageAttachments([file(type)])).toBeNull()
    }
  })

  it('rejects a file over the size limit', () => {
    expect(validateImageAttachments([file('image/png', MAX_ATTACHED_IMAGE_SIZE + 1)])).toBe(
      'too-large',
    )
  })

  it('accepts a file exactly at the size limit', () => {
    expect(validateImageAttachments([file('image/png', MAX_ATTACHED_IMAGE_SIZE)])).toBeNull()
  })

  it('reports the count problem before inspecting individual files', () => {
    expect(
      validateImageAttachments([file('image/gif'), file('image/gif'), file('image/gif')], 2),
    ).toBe('too-many')
  })
})
