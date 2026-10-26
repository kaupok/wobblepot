import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { exportUserData } from '@/lib/auth/export'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks.

const DAY_MS = 24 * 60 * 60 * 1000

async function user(
  id: string,
  data: { acceptedTermsAt?: Date; acceptedTermsVersion?: number } = {},
) {
  await prisma.user.create({ data: { id, name: id, email: `${id}@example.com`, ...data } })
  await prisma.account.create({
    data: {
      id: `account-${id}`,
      accountId: id,
      providerId: 'credential',
      userId: id,
      password: 'secret-hash',
    },
  })
  await prisma.session.create({
    data: {
      id: `session-${id}`,
      token: `session-token-${id}`,
      userId: id,
      expiresAt: new Date(Date.now() + DAY_MS),
      ipAddress: '10.0.0.1',
      userAgent: 'Firefox',
    },
  })
}

function ingredient(id: string, name: string, householdId: string | null = null) {
  return prisma.ingredient.create({
    data: {
      id,
      name,
      householdId,
      category: 'vegetable',
      defaultUnit: 'g',
      allergens: [],
      calories: 100,
      protein: 1,
      carbs: 2,
      fat: 3,
    },
  })
}

/**
 * Alder: Ann (owner), Ben (member, with an account) and Kid (no account), a
 * custom ingredient, a meal, a deleted meal, a plan, pantry, a favourite,
 * custom shopping items, an invite and AI usage. Birch: Bo alone, with rows of
 * each kind that must never reach an Alder export. Global ingredients are
 * referenced from Alder's rows and exclusion lists, plus one nothing uses.
 */
async function world() {
  for (const [id, name] of [
    ['g-chicken', 'Chicken breast'],
    ['g-rice', 'Rice'],
    ['g-egg', 'Egg'],
    ['g-mushroom', 'Mushroom'],
    ['g-celery', 'Celery'],
    ['g-olive', 'Olive'],
    ['g-unused', 'Saffron'],
  ]) {
    await ingredient(id!, name!)
  }
  await user('ann')
  await user('ben')
  await user('bo')

  await prisma.oauthClient.create({
    data: { id: 'oauth-claude', clientId: 'client-claude', name: 'Claude' },
  })
  await prisma.oauthConsent.create({
    data: {
      id: 'consent-ann',
      clientId: 'client-claude',
      userId: 'ann',
      scopes: ['openid', 'mcp:read'],
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      updatedAt: new Date('2026-10-02T00:00:00.000Z'),
    },
  })
  await prisma.oauthRefreshToken.create({
    data: {
      id: 'refresh-ann',
      token: 'oauth-refresh-secret',
      clientId: 'client-claude',
      userId: 'ann',
    },
  })

  const alder = await prisma.household.create({
    data: {
      id: 'hh-alder',
      name: 'Alder',
      preferences: { create: { excludedIngredientIds: ['g-mushroom'] } },
      members: {
        create: [
          {
            id: 'm-ann',
            userId: 'ann',
            role: 'owner',
            joinedAt: new Date('2026-01-01T00:00:00.000Z'),
            reminderWeekday: 7,
            reminderConsentAt: new Date('2026-10-01T00:00:00.000Z'),
            reminderConfirmedAt: new Date('2026-10-01T00:05:00.000Z'),
            reminderLastSentAt: new Date('2026-10-04T16:00:00.000Z'),
            reminderToken: 'ann-stop-token',
            reminderConfirmToken: 'ann-confirm-token',
            preferences: { create: { displayName: 'Ann', excludedIngredientIds: ['g-celery'] } },
          },
          {
            id: 'm-ben',
            userId: 'ben',
            role: 'member',
            joinedAt: new Date('2026-02-01T00:00:00.000Z'),
            reminderWeekday: 3,
            reminderConsentAt: new Date('2026-10-02T00:00:00.000Z'),
            reminderToken: 'ben-stop-token',
            reminderConfirmToken: 'ben-confirm-token',
            preferences: { create: { displayName: 'Ben', excludedIngredientIds: ['g-olive'] } },
          },
          {
            id: 'm-kid',
            name: 'Kid',
            role: 'member',
            joinedAt: new Date('2026-03-01T00:00:00.000Z'),
          },
        ],
      },
    },
  })
  const birch = await prisma.household.create({
    data: {
      id: 'hh-birch',
      name: 'Birch',
      members: { create: [{ id: 'm-bo', userId: 'bo', role: 'owner' }] },
    },
  })

  await ingredient('a-sauce', 'Grandma sauce', alder.id)
  await prisma.ingredientTranslation.create({
    data: { ingredientId: 'a-sauce', locale: 'et', name: 'Vanaema kaste' },
  })
  await ingredient('b-relish', 'Neighbour relish', birch.id)

  for (const household of [alder, birch]) {
    const tag = household.name.toLowerCase()
    const own = household.id === alder.id ? 'a-sauce' : 'b-relish'
    await prisma.meal.create({
      data: {
        id: `meal-${tag}`,
        name: `${household.name} stew`,
        householdId: household.id,
        components: {
          create: [
            { ingredientId: own, quantityPerServing: 50 },
            ...(household.id === alder.id
              ? [{ ingredientId: 'g-chicken', quantityPerServing: 150 }]
              : []),
          ],
        },
      },
    })
    await prisma.mealPlan.create({
      data: {
        id: `plan-${tag}`,
        householdId: household.id,
        entries: {
          create: { mealId: `meal-${tag}`, date: new Date('2026-10-12'), mealType: 'dinner' },
        },
      },
    })
    await prisma.favoriteMeal.create({ data: { householdId: household.id, mealId: `meal-${tag}` } })
    await prisma.householdInvite.create({
      data: {
        householdId: household.id,
        code: `invite-${tag}`,
        expiresAt: new Date(Date.now() + DAY_MS),
      },
    })
    await prisma.aiUsage.create({
      data: {
        householdId: household.id,
        feature: 'plan_generate',
        model: 'claude',
        inputTokens: 100,
        outputTokens: 50,
        estimatedCostUsd: 0.01,
      },
    })
  }

  // Soft-deleted meals are still the household's data under GDPR.
  await prisma.meal.create({
    data: {
      id: 'meal-alder-deleted',
      name: 'Old soup',
      householdId: alder.id,
      deletedAt: new Date(),
    },
  })
  await prisma.pantryItem.create({ data: { householdId: alder.id, ingredientId: 'g-rice' } })
  // A reference to another household's ingredient stays unresolved.
  await prisma.pantryItem.create({ data: { householdId: alder.id, ingredientId: 'b-relish' } })
  await prisma.pantryItem.create({ data: { householdId: birch.id, ingredientId: 'g-unused' } })
  await prisma.customShoppingItem.create({
    data: { householdId: alder.id, name: 'Eggs', ingredientId: 'g-egg' },
  })
  await prisma.customShoppingItem.create({ data: { householdId: alder.id, name: 'Candles' } })
  await prisma.customShoppingItem.create({ data: { householdId: birch.id, name: 'Birch candles' } })
}

/** The export as the route sends it: through JSON, dates as strings. */
async function exportOf(userId: string) {
  return JSON.parse(JSON.stringify(await exportUserData(userId)))
}

const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort()

/** Recursive assertion helper: no key named `target` appears anywhere. */
function keysNamed(value: unknown, target: string, path = '$'): string[] {
  if (Array.isArray(value))
    return value.flatMap((item, i) => keysNamed(item, target, `${path}[${i}]`))
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => [
      ...(key === target ? [`${path}.${key}`] : []),
      ...keysNamed(child, target, `${path}.${key}`),
    ])
  }
  return []
}

describe('exportUserData', () => {
  it("holds the owner's profile, sessions and full household tree", async () => {
    await world()

    const data = await exportOf('ann')

    expect(data.user).toMatchObject({ id: 'ann', email: 'ann@example.com', acceptedTermsAt: null })
    expect(data.user.sessions).toEqual([
      expect.objectContaining({ id: 'session-ann', ipAddress: '10.0.0.1', userAgent: 'Firefox' }),
    ])
    expect(data.households).toHaveLength(1)
    const [alder] = data.households
    expect(alder.role).toBe('owner')
    expect(alder.household).toMatchObject({ id: 'hh-alder', name: 'Alder' })
    expect(ids(alder.members)).toEqual(['m-ann', 'm-ben', 'm-kid'])
    expect(alder.members.find((m: { id: string }) => m.id === 'm-ben')).toMatchObject({
      userId: 'ben',
      preferences: { displayName: 'Ben' },
    })
    expect(ids(alder.meals)).toEqual(['meal-alder', 'meal-alder-deleted'])
    expect(alder.mealPlans).toEqual([
      expect.objectContaining({
        id: 'plan-alder',
        entries: [expect.objectContaining({ mealId: 'meal-alder' })],
      }),
    ])
    expect(alder.pantryItems.map((p: { ingredientId: string }) => p.ingredientId).sort()).toEqual([
      'b-relish',
      'g-rice',
    ])
    expect(alder.favoriteMeals.map((f: { mealId: string }) => f.mealId)).toEqual(['meal-alder'])
    expect(alder.customShoppingItems.map((c: { name: string }) => c.name).sort()).toEqual([
      'Candles',
      'Eggs',
    ])
    expect(alder.invites.map((i: { code: string }) => i.code)).toEqual(['invite-alder'])
    expect(alder.aiUsage).toHaveLength(1)
  })

  // No screen or route sets member food rules since HON-1322, but the columns
  // still hold what households saved before February 2026, and that is their data.
  it('holds the member food and macro values a preferences row still stores', async () => {
    await world()
    await prisma.memberPreferences.create({
      data: {
        memberId: 'm-kid',
        targetCalories: 1800,
        targetProtein: 80,
        dietaryType: 'vegan',
        allergens: ['nuts'],
        restrictions: ['low-salt'],
        excludedIngredients: ['celery'],
      },
    })

    const [alder] = (await exportOf('ann')).households

    expect(alder.members.find((m: { id: string }) => m.id === 'm-kid').preferences).toMatchObject({
      targetCalories: 1800,
      targetProtein: 80,
      dietaryType: 'vegan',
      allergens: ['nuts'],
      restrictions: ['low-salt'],
      excludedIngredients: ['celery'],
    })
  })

  it('holds nothing from another household', async () => {
    await world()

    const json = JSON.stringify(await exportOf('ann'))

    for (const fromBirch of [
      'hh-birch',
      'Birch',
      'meal-birch',
      'plan-birch',
      'invite-birch',
      'm-bo',
      'Neighbour relish',
      'g-unused',
    ]) {
      expect(json).not.toContain(fromBirch)
    }
  })

  it('gives a member the shared household, with other members redacted and no invites or AI usage', async () => {
    await world()

    const [alder] = (await exportOf('ben')).households

    expect(alder.role).toBe('member')
    expect(ids(alder.meals)).toEqual(['meal-alder', 'meal-alder-deleted'])
    expect(alder.members.find((m: { id: string }) => m.id === 'm-ben')).toMatchObject({
      userId: 'ben',
      preferences: { displayName: 'Ben' },
    })
    expect(alder.members.find((m: { id: string }) => m.id === 'm-ann')).toEqual({
      id: 'm-ann',
      role: 'owner',
      joinedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(alder.members.find((m: { id: string }) => m.id === 'm-kid')).toEqual({
      id: 'm-kid',
      role: 'member',
      joinedAt: '2026-03-01T00:00:00.000Z',
    })
    expect(alder).not.toHaveProperty('invites')
    expect(alder).not.toHaveProperty('aiUsage')
  })

  it("carries the weekly reminder on the caller's own row only, never its tokens", async () => {
    await world()

    const data = await exportOf('ann')
    const members = data.households[0].members

    expect(members.find((m: { id: string }) => m.id === 'm-ann')).toMatchObject({
      reminderWeekday: 7,
      reminderConsentAt: '2026-10-01T00:00:00.000Z',
      reminderConfirmedAt: '2026-10-01T00:05:00.000Z',
      reminderLastSentAt: '2026-10-04T16:00:00.000Z',
    })
    expect(members.find((m: { id: string }) => m.id === 'm-ben')).not.toHaveProperty(
      'reminderWeekday',
    )
    expect(JSON.stringify(data)).not.toContain('stop-token')
    expect(JSON.stringify(data)).not.toContain('confirm-token')
  })

  it('lists the apps the user connected through OAuth, without tokens (HON-1150)', async () => {
    await world()

    const data = await exportOf('ann')

    expect(data.user.connectedApps).toEqual([
      {
        appName: 'Claude',
        scopes: ['openid', 'mcp:read'],
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-02T00:00:00.000Z',
      },
    ])
    expect(JSON.stringify(data)).not.toContain('oauth-refresh-secret')
  })

  it('never exposes a password or token anywhere', async () => {
    await world()

    const data = await exportOf('ann')

    for (const key of ['password', 'token', 'accessToken', 'refreshToken']) {
      expect(keysNamed(data, key)).toEqual([])
    }
    expect(JSON.stringify(data)).not.toContain('secret-hash')
    expect(JSON.stringify(data)).not.toContain('session-token-ann')
  })

  it('round-trips the consent fields of a consented user, and exports no household without one (HON-457)', async () => {
    await user('cora', {
      acceptedTermsAt: new Date('2026-06-03T10:00:00.000Z'),
      acceptedTermsVersion: 1,
    })

    const data = await exportOf('cora')

    expect(data.user).toMatchObject({
      acceptedTermsAt: '2026-06-03T10:00:00.000Z',
      acceptedTermsVersion: 1,
    })
    expect(data.households).toEqual([])
  })

  it('throws when the user does not exist', async () => {
    await expect(exportUserData('nobody')).rejects.toThrow('User not found')
  })

  describe('ingredients (HON-880)', () => {
    it.each(['ann', 'ben'])(
      "exports the household's own ingredients in full, with translations, for %s",
      async (userId) => {
        await world()

        const [alder] = (await exportOf(userId)).households

        expect(alder.ingredients).toEqual([
          expect.objectContaining({
            id: 'a-sauce',
            name: 'Grandma sauce',
            calories: 100,
            translations: [expect.objectContaining({ locale: 'et', name: 'Vanaema kaste' })],
          }),
        ])
      },
    )

    it('resolves each referenced global ingredient to id, name and defaultUnit only', async () => {
      await world()

      const [alder] = (await exportOf('ann')).households

      expect(alder.referencedGlobalIngredients).toEqual([
        { id: 'g-celery', name: 'Celery', defaultUnit: 'g' },
        { id: 'g-chicken', name: 'Chicken breast', defaultUnit: 'g' },
        { id: 'g-egg', name: 'Egg', defaultUnit: 'g' },
        { id: 'g-mushroom', name: 'Mushroom', defaultUnit: 'g' },
        { id: 'g-olive', name: 'Olive', defaultUnit: 'g' },
        { id: 'g-rice', name: 'Rice', defaultUnit: 'g' },
      ])
    })

    it("exports each entry's ingredient changes and resolves the globals they name", async () => {
      await world()
      await ingredient('g-yoghurt', 'Yoghurt')
      const entry = await prisma.mealPlanEntry.findFirstOrThrow({ where: { planId: 'plan-alder' } })
      await prisma.mealPlanEntryComponent.create({
        data: {
          entryId: entry.id,
          originalIngredientId: 'g-chicken',
          replacementIngredientId: 'g-yoghurt',
          quantityPerServing: 60,
        },
      })

      const [alder] = (await exportOf('ann')).households

      expect(alder.mealPlans[0]!.entries[0]!.changes).toEqual([
        expect.objectContaining({
          originalIngredientId: 'g-chicken',
          replacementIngredientId: 'g-yoghurt',
          quantityPerServing: 60,
        }),
      ])
      expect(ids(alder.referencedGlobalIngredients)).toContain('g-yoghurt')
    })

    it("does not reveal a redacted member's exclusions through referencedGlobalIngredients", async () => {
      await world()

      const [alder] = (await exportOf('ben')).households
      const referenced = ids(alder.referencedGlobalIngredients)

      // Ben's own and the household's exclusions resolve; Ann's are redacted.
      expect(referenced).toContain('g-olive')
      expect(referenced).toContain('g-mushroom')
      expect(referenced).not.toContain('g-celery')
    })

    it('exports no ingredients for a household that references none', async () => {
      await user('dan')
      await prisma.household.create({
        data: { name: 'Empty', members: { create: [{ userId: 'dan', role: 'owner' }] } },
      })

      const [empty] = (await exportOf('dan')).households

      expect(empty.ingredients).toEqual([])
      expect(empty.referencedGlobalIngredients).toEqual([])
    })
  })
})
