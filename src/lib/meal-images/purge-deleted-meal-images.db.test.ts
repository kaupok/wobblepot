import { describe, expect, it, vi } from 'vitest'

import { purgeExpiredDeletedMealImages } from '@/lib/meal-images/purge-deleted-meal-images'
import { prisma } from '@/lib/prisma'

// Runs against PGlite through the `unit-db` project (HON-1186), with no
// module mocks; one test spies on the transaction to make a clear fail.
// The cron route test covers the file delete after these clears commit.

const NOW = new Date('2026-10-26T03:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS)
const imageOf = (id: string) => `https://store.example/meals/${id}.png`

async function meal(id: string, deletedAt: Date | null) {
  await prisma.meal.create({
    data: {
      id,
      name: id,
      suitableFor: ['dinner'],
      deletedAt,
      imageUrl: imageOf(id),
      imageStatus: 'ready',
      imageHue: 40,
    },
  })
}

async function imageColumns(id: string) {
  return prisma.meal.findUniqueOrThrow({
    where: { id },
    select: { imageUrl: true, imageStatus: true, imageHue: true, deletedAt: true },
  })
}

describe('purgeExpiredDeletedMealImages', () => {
  it('clears the image of a recipe deleted 31 days ago, keeps its row, and returns the URL', async () => {
    await meal('deleted-31', daysAgo(31))

    expect(await purgeExpiredDeletedMealImages(NOW)).toEqual([imageOf('deleted-31')])
    expect(await imageColumns('deleted-31')).toEqual({
      imageUrl: null,
      imageStatus: 'none',
      imageHue: null,
      deletedAt: daysAgo(31),
    })
  })

  it('keeps the image of a recipe deleted 29 days ago and of a live recipe', async () => {
    await meal('deleted-29', daysAgo(29))
    await meal('live', null)

    expect(await purgeExpiredDeletedMealImages(NOW)).toEqual([])
    expect((await imageColumns('deleted-29')).imageUrl).toBe(imageOf('deleted-29'))
    expect((await imageColumns('live')).imageUrl).toBe(imageOf('live'))
  })

  it('skips a recipe deleted long ago whose image is already cleared', async () => {
    await prisma.meal.create({
      data: { id: 'bare', name: 'bare', suitableFor: ['dinner'], deletedAt: daysAgo(90) },
    })

    expect(await purgeExpiredDeletedMealImages(NOW)).toEqual([])
  })
  it('returns the URLs it cleared when a later clear fails, and leaves the failed one for the next run', async () => {
    await meal('a-deleted', daysAgo(31))
    await meal('b-deleted', daysAgo(40))
    await meal('c-deleted', daysAgo(50))
    const transaction = prisma.$transaction.bind(prisma)
    const spy = vi.spyOn(prisma, '$transaction')
    spy.mockImplementationOnce(transaction as never)
    spy.mockImplementationOnce(transaction as never)
    spy.mockRejectedValueOnce(new Error('connection lost'))

    try {
      expect(await purgeExpiredDeletedMealImages(NOW)).toEqual([
        imageOf('a-deleted'),
        imageOf('b-deleted'),
      ])
    } finally {
      spy.mockRestore()
    }
    expect((await imageColumns('c-deleted')).imageUrl).toBe(imageOf('c-deleted'))
    expect(await purgeExpiredDeletedMealImages(NOW)).toEqual([imageOf('c-deleted')])
  })
})
