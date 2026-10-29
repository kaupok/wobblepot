import { describe, expect, it } from 'vitest'

import { clearMealImage } from '@/lib/meal-images/invalidation'
import {
  attachMealImage,
  claimMealImage,
  type ImageClaim,
  loadMealForImage,
  markMealImageFailed,
  readMealImage,
  releaseMealImageClaim,
} from '@/lib/meal-images/persist'
import { prisma } from '@/lib/prisma'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks:
// rows are written with Prisma, changed through the lib functions, and read
// back. The route test covers only how the route maps these answers.

/** The prompt version `prompt.ts` draws at today; `v3` is an older one. */
const CURRENT = 'v4'
const STALE = 'v3'

const EDITED_AT = new Date('2026-09-20T10:00:00Z')
const NOW = new Date('2026-10-14T12:00:00Z')
const OLD_URL = 'https://blob/meals/meal-1-old.png'
const NEW_URL = 'https://blob/meals/meal-1-new.png'

/**
 * Alder owns `meal-1` (pita with hummus), Birch owns `meal-birch`, and
 * `meal-library` is a shared catalogue meal. `meal-1` takes `over` for its
 * image columns.
 */
async function world(over: Record<string, unknown> = {}) {
  await prisma.ingredient.create({
    data: {
      id: 'ing-pita',
      name: 'pita',
      category: 'carb',
      defaultUnit: 'piece',
      gramsPerPiece: 60,
      calories: 1,
      protein: 0,
      carbs: 0,
      fat: 0,
    },
  })
  const alder = await prisma.household.create({ data: { name: 'Alder' } })
  const birch = await prisma.household.create({ data: { name: 'Birch' } })
  await prisma.meal.create({
    data: {
      id: 'meal-1',
      name: 'Pita with hummus',
      description: 'Warm pita and hummus',
      householdId: alder.id,
      components: { create: { ingredientId: 'ing-pita', quantityPerServing: 1 } },
      ...over,
      updatedAt: EDITED_AT,
    },
  })
  await prisma.meal.create({ data: { id: 'meal-birch', name: 'Soup', householdId: birch.id } })
  await prisma.meal.create({ data: { id: 'meal-library', name: 'Porridge' } })
  return { alder: alder.id, birch: birch.id }
}

const readMeal = () => prisma.meal.findUniqueOrThrow({ where: { id: 'meal-1' } })

/** Reads `meal-1` as the route does, then claims it at `now`. */
async function claim(householdId: string, now = NOW): Promise<ImageClaim | null> {
  const meal = await loadMealForImage(householdId, 'meal-1')
  return claimMealImage(meal!, now)
}

describe('loadMealForImage', () => {
  it("reads the household's meal with its content and image state", async () => {
    const { alder } = await world({ imageStatus: 'failed', imageAttempts: 2 })

    const meal = await loadMealForImage(alder, 'meal-1')

    expect(meal).toMatchObject({
      id: 'meal-1',
      name: 'Pita with hummus',
      description: 'Warm pita and hummus',
      householdId: alder,
      updatedAt: EDITED_AT,
      imageStatus: 'failed',
      imageAttempts: 2,
      components: [
        {
          quantityPerServing: 1,
          ingredient: {
            name: 'pita',
            defaultUnit: 'piece',
            gramsPerPiece: 60,
            densityGPerMl: null,
          },
        },
      ],
    })
  })

  it('reads a library meal', async () => {
    const { alder } = await world()

    expect(await loadMealForImage(alder, 'meal-library')).toMatchObject({ householdId: null })
  })

  it("answers null for another household's meal and a deleted meal", async () => {
    const { alder } = await world()
    await prisma.meal.update({ where: { id: 'meal-library' }, data: { deletedAt: new Date() } })

    expect(await loadMealForImage(alder, 'meal-birch')).toBeNull()
    expect(await loadMealForImage(alder, 'meal-library')).toBeNull()
  })
})

describe('readMealImage', () => {
  it('returns a ready image at the current prompt version with its hue', async () => {
    const { alder } = await world({
      imageStatus: 'ready',
      imageUrl: OLD_URL,
      imageHue: 40,
      imagePromptVersion: CURRENT,
    })

    expect(await readMealImage(alder, 'meal-1')).toEqual({
      imageStatus: 'ready',
      imageUrl: OLD_URL,
      imageHue: 40,
    })
  })

  it('detects an image at a stale prompt version and reads it as none', async () => {
    const { alder } = await world({
      imageStatus: 'ready',
      imageUrl: OLD_URL,
      imageHue: 40,
      imagePromptVersion: STALE,
    })

    expect(await readMealImage(alder, 'meal-1')).toEqual({
      imageStatus: 'none',
      imageUrl: null,
      imageHue: null,
    })
  })

  it("answers null for another household's meal", async () => {
    const { birch } = await world()

    expect(await readMealImage(birch, 'meal-1')).toBeNull()
  })
})

describe('claimMealImage', () => {
  it('claims a meal with no image, and leaves updatedAt alone', async () => {
    const { alder } = await world()

    expect(await claim(alder)).toEqual({
      mealId: 'meal-1',
      claimedAt: NOW,
      updatedAt: EDITED_AT,
      redraw: false,
    })
    expect(await readMeal()).toMatchObject({
      imageStatus: 'generating',
      imageClaimedAt: NOW,
      updatedAt: EDITED_AT,
    })
  })

  it('grants exactly one of two concurrent claims', async () => {
    const { alder } = await world()
    const meal = (await loadMealForImage(alder, 'meal-1'))!

    const claims = await Promise.all([claimMealImage(meal, NOW), claimMealImage(meal, NOW)])

    expect(claims.filter(Boolean)).toHaveLength(1)
  })

  it('refuses a meal another request claimed less than 3 minutes ago', async () => {
    const { alder } = await world({
      imageStatus: 'generating',
      imageClaimedAt: new Date(NOW.getTime() - 60_000),
    })

    expect(await claim(alder)).toBeNull()
  })

  it('takes over a claim older than 3 minutes', async () => {
    const { alder } = await world({
      imageStatus: 'generating',
      imageClaimedAt: new Date(NOW.getTime() - 3 * 60_000 - 1),
    })

    expect(await claim(alder)).not.toBeNull()
    expect((await readMeal()).imageClaimedAt).toEqual(NOW)
  })

  it('retries a failed image with attempts left, and keeps the count', async () => {
    const { alder } = await world({ imageStatus: 'failed', imageAttempts: 2 })

    expect(await claim(alder)).not.toBeNull()
    expect(await readMeal()).toMatchObject({ imageStatus: 'generating', imageAttempts: 2 })
  })

  it('refuses a meal whose image failed 3 times', async () => {
    const { alder } = await world({ imageStatus: 'failed', imageAttempts: 3 })

    expect(await claim(alder)).toBeNull()
    expect((await readMeal()).imageStatus).toBe('failed')
  })

  it('claims a ready image at a stale prompt version as a redraw, with attempts reset', async () => {
    const { alder } = await world({
      imageStatus: 'ready',
      imageUrl: OLD_URL,
      imagePromptVersion: STALE,
      imageAttempts: 2,
    })

    expect(await claim(alder)).toMatchObject({ redraw: true })
    expect(await readMeal()).toMatchObject({
      imageStatus: 'generating',
      imageUrl: OLD_URL,
      imageAttempts: 0,
      updatedAt: EDITED_AT,
    })
  })

  it('refuses a redraw when another request already redrew the image', async () => {
    const { alder } = await world({ imageStatus: 'ready', imagePromptVersion: STALE })
    const meal = (await loadMealForImage(alder, 'meal-1'))!
    await prisma.meal.update({
      where: { id: 'meal-1' },
      data: { imagePromptVersion: CURRENT, updatedAt: EDITED_AT },
    })

    expect(await claimMealImage(meal, NOW)).toBeNull()
  })

  it('refuses a meal edited since it was read', async () => {
    const { alder } = await world()
    const meal = (await loadMealForImage(alder, 'meal-1'))!
    await prisma.meal.update({ where: { id: 'meal-1' }, data: { name: 'Pita with falafel' } })

    expect(await claimMealImage(meal, NOW)).toBeNull()
    expect((await readMeal()).imageStatus).toBe('none')
  })

  it('refuses a meal deleted since it was read', async () => {
    const { alder } = await world()
    const meal = (await loadMealForImage(alder, 'meal-1'))!
    await prisma.meal.update({
      where: { id: 'meal-1' },
      data: { deletedAt: new Date(), updatedAt: EDITED_AT },
    })

    expect(await claimMealImage(meal, NOW)).toBeNull()
  })
})

describe('attachMealImage', () => {
  it('records the image, the current prompt version, the hue and the vessel', async () => {
    const { alder } = await world()
    const held = (await claim(alder))!

    const attached = await attachMealImage(held, {
      url: NEW_URL,
      hue: 264,
      vessel: { vessel: 'plate', diameterCm: 22 },
    })

    expect(attached).toBe(true)
    expect(await readMeal()).toMatchObject({
      imageStatus: 'ready',
      imageUrl: NEW_URL,
      imagePromptVersion: CURRENT,
      imageHue: 264,
      imageVessel: 'plate',
      imageDiameterCm: 22,
      imageClaimedAt: NOW,
      // The prep-tips cache guard reads updatedAt (HON-683).
      updatedAt: EDITED_AT,
    })
  })

  it('stores no hue and no vessel when there are none', async () => {
    const { alder } = await world({ imageVessel: 'bowl', imageDiameterCm: 15 })
    const held = (await claim(alder))!

    await attachMealImage(held, { url: NEW_URL, hue: null, vessel: null })

    expect(await readMeal()).toMatchObject({
      imageStatus: 'ready',
      imageHue: null,
      imageVessel: null,
      imageDiameterCm: null,
    })
  })

  it('refuses when the meal was edited mid-generation, and leaves it cleared', async () => {
    const { alder } = await world()
    const held = (await claim(alder))!
    // The meal PATCH commits while the image is being drawn (HON-734).
    await clearMealImage(prisma, 'meal-1')

    expect(await attachMealImage(held, { url: NEW_URL, hue: 264, vessel: null })).toBe(false)
    expect(await readMeal()).toMatchObject({ imageStatus: 'none', imageUrl: null })
  })

  it('still attaches when an unrelated edit moved updatedAt mid-generation', async () => {
    const { alder } = await world()
    const held = (await claim(alder))!
    // A servings-only edit: no clearMealImage, but @updatedAt moves.
    const movedTo = new Date('2026-09-21T10:00:00Z')
    await prisma.meal.update({ where: { id: 'meal-1' }, data: { updatedAt: movedTo } })

    expect(await attachMealImage(held, { url: NEW_URL, hue: 264, vessel: null })).toBe(true)
    const meal = await readMeal()
    expect(meal).toMatchObject({ imageStatus: 'ready', imageUrl: NEW_URL })
    expect(meal.updatedAt.getTime()).toBeGreaterThanOrEqual(movedTo.getTime())
  })

  it('refuses when a stale-claim takeover replaced the claim', async () => {
    const { alder } = await world()
    const held = (await claim(alder))!
    await claim(alder, new Date(NOW.getTime() + 3 * 60_000 + 1))

    expect(await attachMealImage(held, { url: NEW_URL, hue: 264, vessel: null })).toBe(false)
    expect((await readMeal()).imageUrl).toBeNull()
  })
})

describe('releaseMealImageClaim', () => {
  it('gives a first drawing back to none without counting an attempt', async () => {
    const { alder } = await world({ imageStatus: 'failed', imageAttempts: 2 })
    const held = (await claim(alder))!

    expect(await releaseMealImageClaim(held)).toBe(true)
    expect(await readMeal()).toMatchObject({
      imageStatus: 'none',
      imageAttempts: 2,
      imageClaimedAt: null,
      updatedAt: EDITED_AT,
    })
  })

  it('gives a stale-version redraw back to the ready row, still on the old blob', async () => {
    const { alder } = await world({
      imageStatus: 'ready',
      imageUrl: OLD_URL,
      imageHue: 120,
      imagePromptVersion: STALE,
    })
    const held = (await claim(alder))!

    await releaseMealImageClaim(held)

    expect(await readMeal()).toMatchObject({
      imageStatus: 'ready',
      imageUrl: OLD_URL,
      imagePromptVersion: STALE,
      imageClaimedAt: null,
    })
  })
})

describe('markMealImageFailed', () => {
  it('marks the image failed and counts the attempt', async () => {
    const { alder } = await world({ imageStatus: 'failed', imageAttempts: 1 })
    const held = (await claim(alder))!

    expect(await markMealImageFailed(held, { countAttempt: true })).toBe(true)
    expect(await readMeal()).toMatchObject({ imageStatus: 'failed', imageAttempts: 2 })
  })

  it('marks the image failed without counting a transient failure', async () => {
    const { alder } = await world({ imageStatus: 'failed', imageAttempts: 1 })
    const held = (await claim(alder))!

    await markMealImageFailed(held, { countAttempt: false })

    expect(await readMeal()).toMatchObject({ imageStatus: 'failed', imageAttempts: 1 })
  })

  it('keeps the old image referenced when a stale-version redraw fails', async () => {
    const { alder } = await world({
      imageStatus: 'ready',
      imageUrl: OLD_URL,
      imagePromptVersion: STALE,
    })
    const held = (await claim(alder))!

    await markMealImageFailed(held, { countAttempt: true })

    expect(await readMeal()).toMatchObject({
      imageStatus: 'failed',
      imageUrl: OLD_URL,
      imageAttempts: 1,
    })
  })
})
