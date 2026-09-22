import { describe, it, expect, vi } from 'vitest'
import type { Prisma } from '@/generated/prisma/client'
import { clearMealImage } from './invalidation'

const makeTx = (imageUrl: string | null) => {
  const findUniqueOrThrow = vi.fn().mockResolvedValue({ imageUrl })
  const update = vi.fn().mockResolvedValue({})
  const tx = { meal: { findUniqueOrThrow, update } } as unknown as Prisma.TransactionClient
  return { tx, findUniqueOrThrow, update }
}

describe('clearMealImage', () => {
  it('resets all six image columns to their defaults', async () => {
    const { tx, update } = makeTx('https://s.public.blob.vercel-storage.com/meals/m-1.png')

    await clearMealImage(tx, 'meal-1')

    expect(update).toHaveBeenCalledWith({
      where: { id: 'meal-1' },
      data: {
        imageUrl: null,
        imagePromptVersion: null,
        imageStatus: 'none',
        imageClaimedAt: null,
        imageAttempts: 0,
        imageHue: null,
      },
    })
  })

  it('returns the URL the meal pointed at, so the caller can delete the blob', async () => {
    const url = 'https://s.public.blob.vercel-storage.com/meals/m-1.png'
    const { tx, findUniqueOrThrow } = makeTx(url)

    await expect(clearMealImage(tx, 'meal-1')).resolves.toBe(url)
    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'meal-1' },
      select: { imageUrl: true },
    })
  })

  it('returns null for a meal that never had an image', async () => {
    const { tx } = makeTx(null)

    await expect(clearMealImage(tx, 'meal-1')).resolves.toBeNull()
  })
})
