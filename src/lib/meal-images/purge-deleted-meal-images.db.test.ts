import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { purgeExpiredDeletedMealImages } from '@/lib/meal-images/purge-deleted-meal-images'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks.
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
})
