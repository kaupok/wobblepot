import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
  del: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

import { del, put } from '@vercel/blob'
import { captureApiError } from '@/lib/errors'
import { deleteMealImage, discardMealImage, putMealImage } from './storage'

const mockPut = vi.mocked(put)
const mockDel = vi.mocked(del)

const blobUrl = 'https://store123.public.blob.vercel-storage.com/meals/meal-1-AbC123.png'

describe('putMealImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPut.mockResolvedValue({ url: blobUrl } as never)
  })

  it('uploads publicly under meals/{mealId} with a random suffix and returns the URL', async () => {
    const bytes = Buffer.from('png-bytes')

    const url = await putMealImage('meal-1', bytes, 'image/png')

    expect(url).toBe(blobUrl)
    expect(mockPut).toHaveBeenCalledWith('meals/meal-1.png', bytes, {
      access: 'public',
      addRandomSuffix: true,
      contentType: 'image/png',
    })
  })

  it('names the file after the media type', async () => {
    await putMealImage('meal-1', Buffer.from('x'), 'image/webp')

    expect(mockPut).toHaveBeenCalledWith('meals/meal-1.webp', expect.anything(), expect.anything())
  })

  it('rejects a media type it cannot name, without uploading', async () => {
    await expect(putMealImage('meal-1', Buffer.from('x'), 'image/gif')).rejects.toThrow(
      'Unsupported meal image media type',
    )
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('does not pass credentials in — the SDK reads them from the environment', async () => {
    await putMealImage('meal-1', Buffer.from('x'), 'image/png')

    const options = mockPut.mock.calls[0]?.[2]
    expect(options).not.toHaveProperty('token')
    expect(options).not.toHaveProperty('storeId')
  })
})

describe('deleteMealImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes the blob by URL', async () => {
    mockDel.mockResolvedValue(undefined)

    await deleteMealImage(blobUrl)

    expect(mockDel).toHaveBeenCalledWith(blobUrl)
  })

  it('propagates a failed delete', async () => {
    mockDel.mockRejectedValue(new Error('blob down'))

    await expect(deleteMealImage(blobUrl)).rejects.toThrow('blob down')
  })
})

describe('discardMealImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes the blob when there is one', async () => {
    mockDel.mockResolvedValue(undefined)

    await discardMealImage(blobUrl, '/api/test')

    expect(mockDel).toHaveBeenCalledWith(blobUrl)
  })

  it('does nothing when the meal had no image', async () => {
    await discardMealImage(null, '/api/test')

    expect(mockDel).not.toHaveBeenCalled()
  })

  it('reports and swallows a failed delete', async () => {
    const error = new Error('blob down')
    mockDel.mockRejectedValue(error)

    await expect(discardMealImage(blobUrl, '/api/test')).resolves.toBeUndefined()
    expect(vi.mocked(captureApiError)).toHaveBeenCalledWith(error, {
      route: '/api/test',
      operation: 'meal-image-delete',
    })
  })
})
