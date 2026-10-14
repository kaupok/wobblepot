import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership } from '@/lib/household'
import {
  getOrCreateMemberPreferences,
  updateHouseholdPreferences,
  updateMemberPreferences,
} from '@/lib/household/preferences'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks:
// rows are written with Prisma, changed through the lib functions, and read
// back. The route tests cover only how the routes map these answers.

const DAY = 24 * 60 * 60 * 1000
const TIPS = '["Chop the onions"]'

async function user(id: string) {
  return prisma.user.create({ data: { id, name: id, email: `${id}@example.com` } })
}

/** Two households, Alder and Birch, each with one owner account and no preferences rows. */
async function twoHouseholds() {
  await user('u-alder')
  await user('u-birch')
  const alder = await prisma.household.create({
    data: { name: 'Alder', members: { create: [{ userId: 'u-alder', role: 'owner' }] } },
  })
  const birch = await prisma.household.create({
    data: { name: 'Birch', members: { create: [{ userId: 'u-birch', role: 'owner' }] } },
  })
  return { alder, birch }
}

function ingredient(name: string, householdId: string | null = null) {
  return prisma.ingredient.create({
    data: {
      name,
      householdId,
      category: 'spice',
      defaultUnit: 'g',
      calories: 1,
      protein: 0,
      carbs: 0,
      fat: 0,
    },
  })
}

describe('updateHouseholdPreferences', () => {
  it('creates the preferences row when the household has none', async () => {
    const { alder } = await twoHouseholds()

    const saved = await updateHouseholdPreferences(alder.id, { weekdayMealTypes: ['lunch'] })

    const stored = await prisma.householdPreferences.findUniqueOrThrow({
      where: { householdId: alder.id },
    })
    expect(stored).toMatchObject({ weekdayMealTypes: ['lunch'], weekendMealTypes: ['dinner'] })
    expect(saved).toEqual(stored)
  })

  it('changes only the fields the patch names on an existing row', async () => {
    const { alder } = await twoHouseholds()
    await prisma.householdPreferences.create({
      data: { householdId: alder.id, allergensToAvoid: ['nuts'], restrictions: ['low-salt'] },
    })

    await updateHouseholdPreferences(alder.id, { dietaryType: 'vegan', restrictions: [] })

    expect(
      await prisma.householdPreferences.findUniqueOrThrow({ where: { householdId: alder.id } }),
    ).toMatchObject({ dietaryType: 'vegan', allergensToAvoid: ['nuts'], restrictions: [] })
  })

  // The ids are returned in the response, so matching another household's
  // ingredient would reveal it (HON-889).
  it("resolves excluded names to global and the household's own ingredients, never another's", async () => {
    const { alder, birch } = await twoHouseholds()
    const global = await ingredient('Test pepper blend')
    const own = await ingredient('Grandma spice mix', alder.id)
    await ingredient('Grandma spice mix', birch.id)

    const saved = await updateHouseholdPreferences(alder.id, {
      excludedIngredients: ['grandma SPICE mix', 'test pepper blend'],
    })

    expect(saved.excludedIngredients).toEqual(['grandma SPICE mix', 'test pepper blend'])
    expect([...saved.excludedIngredientIds].sort()).toEqual([global.id, own.id].sort())
    expect(
      await prisma.householdPreferences.findUniqueOrThrow({ where: { householdId: alder.id } }),
    ).toMatchObject({ excludedIngredientIds: saved.excludedIngredientIds })
  })

  // "shrimp" was merged into prawns (HON-1097), so a household that typed it
  // keeps the exclusion when it saves the form again.
  it('also resolves an excluded name through its other English name', async () => {
    const { alder } = await twoHouseholds()
    const prawns = await ingredient('prawns')

    const saved = await updateHouseholdPreferences(alder.id, { excludedIngredients: ['Shrimp'] })

    expect(saved.excludedIngredientIds).toContain(prawns.id)
  })

  it('clears the ids when the excluded names are emptied', async () => {
    const { alder } = await twoHouseholds()
    await prisma.householdPreferences.create({
      data: {
        householdId: alder.id,
        excludedIngredients: ['cilantro'],
        excludedIngredientIds: ['ing-old'],
      },
    })

    const saved = await updateHouseholdPreferences(alder.id, { excludedIngredients: [] })

    expect(saved).toMatchObject({ excludedIngredients: [], excludedIngredientIds: [] })
  })

  it('keeps the stored ids when the patch sends no excluded names', async () => {
    const { alder } = await twoHouseholds()
    await prisma.householdPreferences.create({
      data: { householdId: alder.id, excludedIngredientIds: ['ing-old'] },
    })

    const saved = await updateHouseholdPreferences(alder.id, { restrictions: ['low-salt'] })

    expect(saved.excludedIngredientIds).toEqual(['ing-old'])
  })
})

describe('getOrCreateMemberPreferences', () => {
  it('creates a row with the column defaults when the member has none', async () => {
    await twoHouseholds()
    const membership = await getHouseholdMembership('u-alder')

    const first = await getOrCreateMemberPreferences(membership!.id)
    const second = await getOrCreateMemberPreferences(membership!.id)

    expect(first).toMatchObject({
      memberId: membership!.id,
      portionMultiplier: 1,
      displayName: null,
    })
    expect(second.id).toBe(first.id)
    expect(await prisma.memberPreferences.count()).toBe(1)
  })

  it('returns the stored row', async () => {
    await twoHouseholds()
    const membership = await getHouseholdMembership('u-alder')
    await prisma.memberPreferences.create({
      data: { memberId: membership!.id, displayName: 'Dad', portionMultiplier: 1.5 },
    })

    expect(await getOrCreateMemberPreferences(membership!.id)).toMatchObject({
      displayName: 'Dad',
      portionMultiplier: 1.5,
    })
  })
})

describe('updateMemberPreferences', () => {
  /**
   * Alder: the owner account, a partner account and a manual member, with the
   * given portion sizes (`null` for no preferences row). Its plan holds four
   * entries with cached prep tips: a future one, a past one, a future one
   * with its own serving count, and a completed future one. Birch has a
   * future entry with tips too.
   */
  async function household(portions: [number | null, number | null, number | null]) {
    await user('u-owner')
    await user('u-partner')
    await user('u-birch')
    const member = (portion: number | null) =>
      portion === null ? {} : { preferences: { create: { portionMultiplier: portion } } }
    const future = new Date(Date.now() + 7 * DAY)
    const past = new Date(Date.now() - 7 * DAY)
    const entry = (id: string, date: Date, extra: object = {}) => ({
      id,
      date,
      mealType: 'dinner' as const,
      preparationTips: TIPS,
      ...extra,
    })
    await prisma.household.create({
      data: {
        name: 'Alder',
        members: {
          create: [
            { userId: 'u-owner', role: 'owner', ...member(portions[0]) },
            { userId: 'u-partner', role: 'member', ...member(portions[1]) },
            { name: 'Kid', role: 'member', ...member(portions[2]) },
          ],
        },
        mealPlans: {
          create: {
            entries: {
              create: [
                entry('future', future),
                entry('past', past),
                entry('override', new Date(future.getTime() + DAY), { servingOverride: 4 }),
                entry('completed', new Date(future.getTime() + 2 * DAY), { status: 'completed' }),
              ],
            },
          },
        },
      },
    })
    await prisma.household.create({
      data: {
        name: 'Birch',
        members: { create: [{ userId: 'u-birch', role: 'owner' }] },
        mealPlans: { create: { entries: { create: [entry('birch-future', future)] } } },
      },
    })
  }

  async function tips() {
    const entries = await prisma.mealPlanEntry.findMany({
      select: { id: true, preparationTips: true },
    })
    return Object.fromEntries(entries.map((e) => [e.id, e.preparationTips]))
  }

  const UNTOUCHED = {
    future: TIPS,
    past: TIPS,
    override: TIPS,
    completed: TIPS,
    'birch-future': TIPS,
  }

  it('creates the row with the saved fields when the member has none', async () => {
    await household([null, 1, 0.5])
    const membership = await getHouseholdMembership('u-owner')

    const saved = await updateMemberPreferences(membership!, {
      displayName: 'Dad',
      targetCalories: 2200,
    })

    expect(saved).toMatchObject({ displayName: 'Dad', targetCalories: 2200, portionMultiplier: 1 })
    expect(
      await prisma.memberPreferences.findUniqueOrThrow({ where: { memberId: membership!.id } }),
    ).toEqual(saved)
  })

  // Servings 1 + 1 + 0.5 = 2.5 move to 3, so tips priced at 2.5 are stale on
  // every future entry that uses the household's servings (HON-1040).
  it("clears the tips on the household's future entries when its servings move", async () => {
    await household([1, 1, 0.5])
    const membership = await getHouseholdMembership('u-owner')

    const saved = await updateMemberPreferences(membership!, { portionMultiplier: 1.5 })

    expect(saved.portionMultiplier).toBe(1.5)
    expect(await tips()).toEqual({ ...UNTOUCHED, future: null })
  })

  it('clears them when a member without a preferences row leaves 1×', async () => {
    await household([null, 1, 0.5])
    const membership = await getHouseholdMembership('u-owner')

    await updateMemberPreferences(membership!, { portionMultiplier: 2 })

    expect(await tips()).toEqual({ ...UNTOUCHED, future: null })
  })

  // 1.5 + 0.75 + 0.5 = 2.75 and 1.5 + 1 + 0.5 = 3 both round to 3, so the
  // tips stay priced right and a clear would cost a paid regeneration (HON-684).
  it('keeps the tips when the rounded servings do not move', async () => {
    await household([1.5, 0.75, 0.5])
    const membership = await getHouseholdMembership('u-partner')

    await updateMemberPreferences(membership!, { portionMultiplier: 1 })

    expect(await tips()).toEqual(UNTOUCHED)
  })

  it('keeps the tips when the portion size is saved unchanged', async () => {
    await household([1, 1, 0.5])
    const membership = await getHouseholdMembership('u-owner')

    await updateMemberPreferences(membership!, { portionMultiplier: 1, displayName: 'Dad' })

    expect(await tips()).toEqual(UNTOUCHED)
  })

  it('keeps the tips when the save has no portion size', async () => {
    await household([1, 1, 0.5])
    const membership = await getHouseholdMembership('u-owner')

    await updateMemberPreferences(membership!, { dietaryType: 'vegetarian' })

    expect(await tips()).toEqual(UNTOUCHED)
  })
})
