import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from './route'

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  retryAfterSeconds: vi.fn(() => 86_400),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}))

import { auth } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rate-limit'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockCheckRateLimit = vi.mocked(checkRateLimit)
const mockTransaction = vi.mocked(prisma.$transaction)

function allow() {
  return {
    allowed: true,
    limit: 3,
    remaining: 2,
    resetAt: new Date(Date.now() + 86_400_000),
  }
}

function deny() {
  return {
    allowed: false,
    limit: 3,
    remaining: 0,
    resetAt: new Date('2026-04-21T00:00:00.000Z'),
  }
}

type TxMocks = {
  user: { findUnique: ReturnType<typeof vi.fn> }
  session: { findMany: ReturnType<typeof vi.fn> }
  householdMember: { findMany: ReturnType<typeof vi.fn> }
  household: { findUnique: ReturnType<typeof vi.fn> }
  meal: { findMany: ReturnType<typeof vi.fn> }
  mealPlan: { findMany: ReturnType<typeof vi.fn> }
  pantryItem: { findMany: ReturnType<typeof vi.fn> }
  favoriteMeal: { findMany: ReturnType<typeof vi.fn> }
  customShoppingItem: { findMany: ReturnType<typeof vi.fn> }
  householdInvite: { findMany: ReturnType<typeof vi.fn> }
  aiUsage: { findMany: ReturnType<typeof vi.fn> }
  ingredient: { findMany: ReturnType<typeof vi.fn> }
}

function makeTx(): TxMocks {
  return {
    user: { findUnique: vi.fn() },
    session: { findMany: vi.fn().mockResolvedValue([]) },
    householdMember: { findMany: vi.fn().mockResolvedValue([]) },
    household: { findUnique: vi.fn() },
    meal: { findMany: vi.fn().mockResolvedValue([]) },
    mealPlan: { findMany: vi.fn().mockResolvedValue([]) },
    pantryItem: { findMany: vi.fn().mockResolvedValue([]) },
    favoriteMeal: { findMany: vi.fn().mockResolvedValue([]) },
    customShoppingItem: { findMany: vi.fn().mockResolvedValue([]) },
    householdInvite: { findMany: vi.fn().mockResolvedValue([]) },
    aiUsage: { findMany: vi.fn().mockResolvedValue([]) },
    ingredient: { findMany: vi.fn().mockResolvedValue([]) },
  }
}

type IngredientRow = {
  id: string
  name: string
  householdId: string | null
  defaultUnit: string
  [column: string]: unknown
}

type IngredientFindManyArgs = {
  where: { householdId?: string | null; id?: { in: string[] } }
  select?: Record<string, boolean>
}

/**
 * Backs `tx.ingredient.findMany` with an in-memory table that honours the
 * `where` (householdId, id.in) and `select` the route passes, so a test
 * sees what Postgres would return rather than a canned answer.
 */
function installIngredients(tx: TxMocks, rows: IngredientRow[]) {
  tx.ingredient.findMany.mockImplementation(async (args: IngredientFindManyArgs) => {
    const { where, select } = args
    const matched = rows.filter(
      (row) =>
        (!('householdId' in where) || row.householdId === where.householdId) &&
        (!where.id || where.id.in.includes(row.id)),
    )
    if (!select) return matched
    return matched.map((row) =>
      Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])),
    )
  })
}

function installTx(tx: TxMocks) {
  mockTransaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: TxMocks) => Promise<unknown>)(tx)
    }
    return arg
  })
}

function authedAs(userId: string) {
  mockGetSession.mockResolvedValue({
    user: { id: userId, name: 'Jane Doe', email: 'jane@example.com' },
    session: { id: 'session-1' },
  } as never)
}

/** Recursive assertion helper: no key named `target` appears anywhere. */
function assertNoKey(value: unknown, target: string, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoKey(item, target, `${path}[${i}]`))
    return
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === target) {
        throw new Error(`Key "${target}" leaked at ${path}.${k}`)
      }
      assertNoKey(v, target, `${path}.${k}`)
    }
  }
}

describe('GET /api/auth/user/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(allow())
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
  })

  it('rate-limits the user-id dimension and returns 429 with Retry-After', async () => {
    authedAs('user-429')
    mockCheckRateLimit.mockResolvedValue(deny())

    const response = await GET()
    const body = await response.json()

    expect(mockCheckRateLimit).toHaveBeenCalledWith('user-429', 'data-export')
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('86400')
    expect(body.error).toBe('Rate limit exceeded')
    expect(body.resetAt).toBe('2026-04-21T00:00:00.000Z')
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('returns an owner-household export with schemaVersion, null consent fields for a legacy (pre-policy) user, and full nested tree', async () => {
    authedAs('user-owner')

    const tx = makeTx()
    tx.user.findUnique.mockResolvedValue({
      id: 'user-owner',
      name: 'Owner User',
      email: 'owner@example.com',
      emailVerified: true,
      image: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      // Legacy row: signed up before the consent capture shipped (HON-457)
      acceptedTermsAt: null,
      acceptedTermsVersion: null,
    })
    tx.session.findMany.mockResolvedValue([
      {
        id: 'sess-1',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        updatedAt: new Date('2026-04-01T00:00:00.000Z'),
        expiresAt: new Date('2026-05-01T00:00:00.000Z'),
        ipAddress: '10.0.0.1',
        userAgent: 'Mozilla',
      },
    ])
    tx.householdMember.findMany.mockImplementation(
      async (args: { where: { userId?: string; householdId?: string } }) => {
        if (args.where.userId === 'user-owner') {
          return [{ householdId: 'hh-A', role: 'owner' }]
        }
        if (args.where.householdId === 'hh-A') {
          return [
            {
              id: 'member-owner',
              userId: 'user-owner',
              name: 'Owner User',
              role: 'owner',
              joinedAt: new Date('2026-01-01T00:00:00.000Z'),
              preferences: { id: 'mp-1', displayName: 'Owner' },
            },
          ]
        }
        return []
      },
    )
    tx.household.findUnique.mockResolvedValue({
      id: 'hh-A',
      name: 'Alpha Household',
      timezone: 'Europe/Tallinn',
      preferences: { id: 'hp-1', dietaryType: 'vegetarian' },
    })
    tx.meal.findMany.mockResolvedValue([
      { id: 'meal-1', name: 'Pasta', householdId: 'hh-A', components: [{ id: 'c-1' }] },
    ])
    tx.mealPlan.findMany.mockResolvedValue([
      { id: 'plan-1', householdId: 'hh-A', entries: [{ id: 'e-1' }] },
    ])
    tx.pantryItem.findMany.mockResolvedValue([{ id: 'p-1', householdId: 'hh-A' }])
    tx.favoriteMeal.findMany.mockResolvedValue([{ id: 'f-1', householdId: 'hh-A' }])
    tx.customShoppingItem.findMany.mockResolvedValue([{ id: 'cs-1', householdId: 'hh-A' }])
    tx.householdInvite.findMany.mockResolvedValue([
      { id: 'inv-1', householdId: 'hh-A', code: 'CODE' },
    ])
    tx.aiUsage.findMany.mockResolvedValue([
      {
        id: 'au-1',
        householdId: 'hh-A',
        feature: 'plan_generate',
        inputTokens: 100,
        outputTokens: 50,
      },
    ])

    installTx(tx)

    const response = await GET()
    const text = await response.text()
    const body = JSON.parse(text)

    expect(response.status).toBe(200)
    expect(body.schemaVersion).toBe(1)
    expect(typeof body.exportedAt).toBe('string')
    expect(body.user.id).toBe('user-owner')
    expect(body.user.email).toBe('owner@example.com')
    expect(body.user.acceptedTermsAt).toBeNull()
    expect(body.user.acceptedTermsVersion).toBeNull()
    expect(body.user.sessions).toHaveLength(1)
    expect(body.user.sessions[0].id).toBe('sess-1')

    expect(body.households).toHaveLength(1)
    const ownerHh = body.households[0]
    expect(ownerHh.role).toBe('owner')
    expect(ownerHh.household.id).toBe('hh-A')
    expect(ownerHh.members).toHaveLength(1)
    expect(ownerHh.members[0].name).toBe('Owner User')
    expect(ownerHh.meals).toHaveLength(1)
    expect(ownerHh.mealPlans).toHaveLength(1)
    expect(ownerHh.pantryItems).toHaveLength(1)
    expect(ownerHh.favoriteMeals).toHaveLength(1)
    expect(ownerHh.customShoppingItems).toHaveLength(1)
    expect(ownerHh.invites).toHaveLength(1)
    expect(ownerHh.aiUsage).toHaveLength(1)
  })

  it('round-trips real consent values for a consented user (HON-457)', async () => {
    authedAs('user-consented')

    const tx = makeTx()
    tx.user.findUnique.mockResolvedValue({
      id: 'user-consented',
      name: 'Consented User',
      email: 'consented@example.com',
      emailVerified: true,
      image: null,
      createdAt: new Date('2026-06-03T10:00:00.000Z'),
      updatedAt: new Date('2026-06-03T10:00:00.000Z'),
      acceptedTermsAt: new Date('2026-06-03T10:00:00.000Z'),
      acceptedTermsVersion: 1,
    })
    installTx(tx)

    const response = await GET()
    const body = JSON.parse(await response.text())

    expect(response.status).toBe(200)
    expect(body.user.acceptedTermsAt).toBe('2026-06-03T10:00:00.000Z')
    // Stored as Int (the HON-457 schema), not the string the old stub assumed
    expect(body.user.acceptedTermsVersion).toBe(1)
  })

  it('sets Content-Disposition attachment header with userId + YYYY-MM-DD filename', async () => {
    authedAs('user-attach')

    const tx = makeTx()
    tx.user.findUnique.mockResolvedValue({
      id: 'user-attach',
      name: 'A',
      email: 'a@a.com',
      emailVerified: false,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    installTx(tx)

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T09:30:00.000Z'))

    try {
      const response = await GET()
      expect(response.headers.get('Content-Type')).toBe('application/json')
      expect(response.headers.get('Content-Disposition')).toBe(
        'attachment; filename="wobblepot-export-user-attach-2026-07-15.json"',
      )
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    } finally {
      vi.useRealTimers()
    }
  })

  it('scopes a multi-household user correctly: owner of A (full), non-owner of B (shared context, redacted)', async () => {
    authedAs('user-multi')

    const tx = makeTx()
    tx.user.findUnique.mockResolvedValue({
      id: 'user-multi',
      name: 'Multi',
      email: 'multi@example.com',
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    tx.householdMember.findMany.mockImplementation(
      async (args: { where: { userId?: string; householdId?: string } }) => {
        if (args.where.userId === 'user-multi') {
          return [
            { householdId: 'hh-A', role: 'owner' },
            { householdId: 'hh-B', role: 'member' },
          ]
        }
        if (args.where.householdId === 'hh-A') {
          return [
            {
              id: 'member-A-me',
              userId: 'user-multi',
              name: 'Multi',
              role: 'owner',
              joinedAt: new Date('2026-01-01T00:00:00.000Z'),
              preferences: { id: 'mp-A', displayName: 'Multi' },
              reminderWeekday: 7,
              reminderConsentAt: new Date('2026-10-01T00:00:00.000Z'),
              reminderToken: 'my-stop-token',
              reminderConfirmToken: 'my-confirm-token',
              reminderConfirmedAt: new Date('2026-10-01T00:05:00.000Z'),
              reminderLastSentAt: new Date('2026-10-04T16:00:00.000Z'),
            },
            {
              id: 'member-A-other',
              userId: 'user-a-other',
              name: 'Alice',
              role: 'member',
              joinedAt: new Date('2026-02-01T00:00:00.000Z'),
              preferences: { id: 'mp-A2', displayName: 'Alice' },
              reminderWeekday: 3,
              reminderConsentAt: new Date('2026-10-02T00:00:00.000Z'),
              reminderToken: 'alice-stop-token',
              reminderConfirmToken: 'alice-confirm-token',
              reminderConfirmedAt: null,
              reminderLastSentAt: null,
            },
          ]
        }
        if (args.where.householdId === 'hh-B') {
          return [
            {
              id: 'member-B-owner',
              userId: 'user-b-owner',
              name: 'Bob',
              role: 'owner',
              joinedAt: new Date('2026-01-15T00:00:00.000Z'),
              preferences: { id: 'mp-B1', displayName: 'Bob' },
            },
            {
              id: 'member-B-me',
              userId: 'user-multi',
              name: 'Multi',
              role: 'member',
              joinedAt: new Date('2026-03-01T00:00:00.000Z'),
              preferences: { id: 'mp-B2', displayName: 'Multi' },
            },
          ]
        }
        return []
      },
    )
    tx.household.findUnique.mockImplementation(async (args: { where: { id: string } }) => {
      if (args.where.id === 'hh-A') return { id: 'hh-A', name: 'Alpha', preferences: null }
      if (args.where.id === 'hh-B') return { id: 'hh-B', name: 'Beta', preferences: null }
      return null
    })
    tx.householdInvite.findMany.mockResolvedValue([{ id: 'inv-A', householdId: 'hh-A' }])
    tx.aiUsage.findMany.mockResolvedValue([{ id: 'au-A', householdId: 'hh-A' }])

    installTx(tx)

    const response = await GET()
    const body = JSON.parse(await response.text())

    expect(response.status).toBe(200)
    expect(body.households).toHaveLength(2)

    const ownerHh = body.households.find((h: { role: string }) => h.role === 'owner')
    const memberHh = body.households.find((h: { role: string }) => h.role === 'member')

    // Owner household: full member data for everyone
    expect(ownerHh.household.id).toBe('hh-A')
    expect(ownerHh.members).toHaveLength(2)
    for (const m of ownerHh.members) {
      expect(m.name).toBeTruthy()
      expect(m.preferences).toBeTruthy()
      expect(m.userId).toBeTruthy()
    }
    expect(ownerHh.invites).toHaveLength(1)
    expect(ownerHh.aiUsage).toHaveLength(1)

    // Member household: shared context, other members redacted
    expect(memberHh.household.id).toBe('hh-B')
    expect(memberHh.members).toHaveLength(2)
    const myRow = memberHh.members.find((m: { id: string }) => m.id === 'member-B-me')
    const otherRow = memberHh.members.find((m: { id: string }) => m.id === 'member-B-owner')
    expect(myRow.name).toBe('Multi')
    expect(myRow.preferences).toBeTruthy()
    expect(myRow.userId).toBe('user-multi')
    // Other member redacted
    expect(otherRow.name).toBeUndefined()
    expect(otherRow.preferences).toBeUndefined()
    expect(otherRow.userId).toBeUndefined()
    expect(otherRow.role).toBe('owner')
    expect(otherRow.joinedAt).toBeTruthy()
    // No invites / aiUsage on non-owner households
    expect(memberHh.invites).toBeUndefined()
    expect(memberHh.aiUsage).toBeUndefined()

    // The weekly reminder (HON-1084): the caller's own consent, on their own
    // row only, and never the stop or confirm token (HON-1113).
    const myOwnerRow = ownerHh.members.find((m: { id: string }) => m.id === 'member-A-me')
    expect(myOwnerRow).toMatchObject({
      reminderWeekday: 7,
      reminderConsentAt: '2026-10-01T00:00:00.000Z',
      reminderConfirmedAt: '2026-10-01T00:05:00.000Z',
      reminderLastSentAt: '2026-10-04T16:00:00.000Z',
    })
    expect(myOwnerRow).not.toHaveProperty('reminderToken')
    expect(myOwnerRow).not.toHaveProperty('reminderConfirmToken')
    const aliceRow = ownerHh.members.find((m: { id: string }) => m.id === 'member-A-other')
    expect(aliceRow).not.toHaveProperty('reminderWeekday')
    expect(aliceRow).not.toHaveProperty('reminderConsentAt')
    expect(aliceRow).not.toHaveProperty('reminderConfirmedAt')
    expect(JSON.stringify(body)).not.toContain('stop-token')
    expect(JSON.stringify(body)).not.toContain('confirm-token')
  })

  it('never exposes password or token fields anywhere in the payload', async () => {
    authedAs('user-secrets')

    const tx = makeTx()
    tx.user.findUnique.mockResolvedValue({
      id: 'user-secrets',
      name: 'S',
      email: 's@s.com',
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    // Intentionally spike the session mock: even if something changes
    // upstream and leaks, the recursive key-walk should catch it.
    tx.session.findMany.mockResolvedValue([
      {
        id: 'sess-x',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(),
        ipAddress: '127.0.0.1',
        userAgent: 'ua',
      },
    ])
    installTx(tx)

    const response = await GET()
    const body = JSON.parse(await response.text())

    expect(() => assertNoKey(body, 'password')).not.toThrow()
    expect(() => assertNoKey(body, 'token')).not.toThrow()
    expect(() => assertNoKey(body, 'accessToken')).not.toThrow()
    expect(() => assertNoKey(body, 'refreshToken')).not.toThrow()

    // And the session select should not request the token in the first place:
    const sessionCall = tx.session.findMany.mock.calls[0]?.[0] as
      { select?: Record<string, unknown> } | undefined
    expect(sessionCall?.select).toBeDefined()
    expect('token' in (sessionCall?.select ?? {})).toBe(false)
  })

  describe('ingredients (HON-880)', () => {
    const householdIngredient: IngredientRow = {
      id: 'ing-hh',
      name: 'Grandma sauce',
      householdId: 'hh-A',
      category: 'other',
      defaultUnit: 'g',
      allergens: ['milk'],
      calories: 120,
      protein: 3,
      carbs: 10,
      fat: 8,
      translations: [{ id: 'tr-1', ingredientId: 'ing-hh', locale: 'et', name: 'Vanaema kaste' }],
    }
    const globalChicken: IngredientRow = {
      id: 'ing-chicken',
      name: 'Chicken breast',
      householdId: null,
      category: 'protein',
      defaultUnit: 'g',
      allergens: [],
      calories: 165,
      protein: 31,
      carbs: 0,
      fat: 3.6,
    }
    const globalRice: IngredientRow = {
      id: 'ing-rice',
      name: 'Rice',
      householdId: null,
      category: 'grain',
      defaultUnit: 'g',
      allergens: [],
      calories: 130,
      protein: 2.7,
      carbs: 28,
      fat: 0.3,
    }
    const globalEgg: IngredientRow = {
      id: 'ing-egg',
      name: 'Egg',
      householdId: null,
      category: 'protein',
      defaultUnit: 'piece',
      allergens: ['eggs'],
      calories: 155,
      protein: 13,
      carbs: 1.1,
      fat: 11,
    }
    const globalUnused: IngredientRow = {
      id: 'ing-unused',
      name: 'Saffron',
      householdId: null,
      category: 'spice',
      defaultUnit: 'g',
      allergens: [],
      calories: 310,
      protein: 11,
      carbs: 65,
      fat: 6,
    }
    const otherHouseholdIngredient: IngredientRow = {
      id: 'ing-other-hh',
      name: 'Neighbour relish',
      householdId: 'hh-Z',
      category: 'other',
      defaultUnit: 'g',
      allergens: [],
      calories: 50,
      protein: 1,
      carbs: 10,
      fat: 0,
    }

    // Referenced only from preference exclusion lists.
    const globalMushroom: IngredientRow = {
      id: 'ing-mushroom',
      name: 'Mushroom',
      householdId: null,
      category: 'vegetable',
      defaultUnit: 'g',
      allergens: [],
      calories: 22,
      protein: 3,
      carbs: 3,
      fat: 0.3,
    }
    const globalCelery: IngredientRow = {
      id: 'ing-celery',
      name: 'Celery',
      householdId: null,
      category: 'vegetable',
      defaultUnit: 'g',
      allergens: ['celery'],
      calories: 16,
      protein: 0.7,
      carbs: 3,
      fat: 0.2,
    }
    const globalOlive: IngredientRow = {
      id: 'ing-olive',
      name: 'Olive',
      householdId: null,
      category: 'other',
      defaultUnit: 'g',
      allergens: [],
      calories: 115,
      protein: 0.8,
      carbs: 6,
      fat: 11,
    }

    function setUpHousehold(role: 'owner' | 'member') {
      authedAs('user-ing')
      const tx = makeTx()
      tx.user.findUnique.mockResolvedValue({
        id: 'user-ing',
        name: 'Ing',
        email: 'ing@example.com',
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      tx.householdMember.findMany.mockImplementation(
        async (args: { where: { userId?: string; householdId?: string } }) => {
          if (args.where.userId === 'user-ing') return [{ householdId: 'hh-A', role }]
          if (args.where.householdId === 'hh-A') {
            return [
              {
                id: 'member-me',
                userId: 'user-ing',
                name: 'Ing',
                role,
                joinedAt: new Date('2026-01-01T00:00:00.000Z'),
                preferences: { id: 'mp-me', excludedIngredientIds: ['ing-celery'] },
              },
              {
                id: 'member-other',
                userId: 'user-other',
                name: 'Other',
                role: role === 'owner' ? 'member' : 'owner',
                joinedAt: new Date('2026-01-02T00:00:00.000Z'),
                preferences: { id: 'mp-other', excludedIngredientIds: ['ing-olive'] },
              },
            ]
          }
          return []
        },
      )
      tx.household.findUnique.mockResolvedValue({
        id: 'hh-A',
        name: 'Alpha',
        preferences: { id: 'hp-A', excludedIngredientIds: ['ing-mushroom'] },
      })
      tx.meal.findMany.mockResolvedValue([
        {
          id: 'meal-1',
          householdId: 'hh-A',
          components: [
            { id: 'c-1', mealId: 'meal-1', ingredientId: 'ing-chicken' },
            { id: 'c-2', mealId: 'meal-1', ingredientId: 'ing-hh' },
          ],
        },
      ])
      tx.pantryItem.findMany.mockResolvedValue([
        { id: 'p-1', householdId: 'hh-A', ingredientId: 'ing-rice' },
        { id: 'p-2', householdId: 'hh-A', ingredientId: 'ing-chicken' },
      ])
      tx.customShoppingItem.findMany.mockResolvedValue([
        { id: 'cs-1', householdId: 'hh-A', name: 'Eggs', ingredientId: 'ing-egg' },
        { id: 'cs-2', householdId: 'hh-A', name: 'Candles', ingredientId: null },
      ])
      installIngredients(tx, [
        householdIngredient,
        globalChicken,
        globalRice,
        globalEgg,
        globalUnused,
        otherHouseholdIngredient,
        globalMushroom,
        globalCelery,
        globalOlive,
      ])
      installTx(tx)
      return tx
    }

    async function exportHousehold() {
      const response = await GET()
      expect(response.status).toBe(200)
      const body = JSON.parse(await response.text())
      return body.households[0]
    }

    it.each(['owner', 'member'] as const)(
      'exports the household-scoped ingredients in full, with translations, for a %s',
      async (role) => {
        const tx = setUpHousehold(role)
        const hh = await exportHousehold()

        expect(hh.ingredients).toEqual([householdIngredient])
        expect(hh.ingredients[0].translations).toEqual([
          { id: 'tr-1', ingredientId: 'ing-hh', locale: 'et', name: 'Vanaema kaste' },
        ])
        expect(tx.ingredient.findMany).toHaveBeenCalledWith({
          where: { householdId: 'hh-A' },
          include: { translations: { orderBy: { locale: 'asc' } } },
          orderBy: { name: 'asc' },
        })
      },
    )

    it('exports a referenced global ingredient with only id, name and defaultUnit', async () => {
      setUpHousehold('owner')
      const hh = await exportHousehold()

      const chicken = hh.referencedGlobalIngredients.find(
        (i: { id: string }) => i.id === 'ing-chicken',
      )
      expect(chicken).toEqual({ id: 'ing-chicken', name: 'Chicken breast', defaultUnit: 'g' })
      for (const ingredient of hh.referencedGlobalIngredients) {
        expect(Object.keys(ingredient).sort()).toEqual(['defaultUnit', 'id', 'name'])
      }
    })

    it('does not export a global ingredient nothing in the household references', async () => {
      const tx = setUpHousehold('owner')
      const hh = await exportHousehold()

      const ids = hh.referencedGlobalIngredients.map((i: { id: string }) => i.id)
      expect(ids).not.toContain('ing-unused')
      expect(ids).not.toContain('ing-other-hh')
      expect(ids.sort()).toEqual([
        'ing-celery',
        'ing-chicken',
        'ing-egg',
        'ing-mushroom',
        'ing-olive',
        'ing-rice',
      ])

      // One global lookup for the household, restricted to globals, never
      // re-fetching the household's own ingredient.
      const globalCalls = tx.ingredient.findMany.mock.calls
        .map(([args]) => args as IngredientFindManyArgs)
        .filter((args) => args.where.id !== undefined)
      expect(globalCalls).toHaveLength(1)
      expect(globalCalls[0]?.where.householdId).toBeNull()
      expect(globalCalls[0]?.where.id?.in).not.toContain('ing-hh')
    })

    it('resolves every exported ingredientId within the export', async () => {
      setUpHousehold('owner')
      const hh = await exportHousehold()

      const known = new Set<string>([
        ...hh.ingredients.map((i: { id: string }) => i.id),
        ...hh.referencedGlobalIngredients.map((i: { id: string }) => i.id),
      ])
      const referenced: string[] = [
        ...hh.meals.flatMap((m: { components: { ingredientId: string }[] }) =>
          m.components.map((c) => c.ingredientId),
        ),
        ...hh.pantryItems.map((p: { ingredientId: string }) => p.ingredientId),
        ...hh.customShoppingItems
          .map((c: { ingredientId: string | null }) => c.ingredientId)
          .filter((id: string | null): id is string => id !== null),
        ...hh.household.preferences.excludedIngredientIds,
        ...hh.members.flatMap(
          (m: { preferences?: { excludedIngredientIds: string[] } }) =>
            m.preferences?.excludedIngredientIds ?? [],
        ),
      ]

      expect(referenced.length).toBeGreaterThan(0)
      for (const id of referenced) expect(known).toContain(id)
    })

    it("does not reveal a redacted member's exclusions through referencedGlobalIngredients", async () => {
      setUpHousehold('member')
      const hh = await exportHousehold()

      const ids = hh.referencedGlobalIngredients.map((i: { id: string }) => i.id)
      // Own and household-level exclusions resolve...
      expect(ids).toContain('ing-celery')
      expect(ids).toContain('ing-mushroom')
      // ...but the other member's preferences are redacted, so theirs must not.
      expect(ids).not.toContain('ing-olive')
    })

    it('skips the global lookup when the household references no ingredients', async () => {
      authedAs('user-empty')
      const tx = makeTx()
      tx.user.findUnique.mockResolvedValue({
        id: 'user-empty',
        name: 'E',
        email: 'e@example.com',
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      tx.householdMember.findMany.mockImplementation(
        async (args: { where: { userId?: string } }) =>
          args.where.userId === 'user-empty' ? [{ householdId: 'hh-A', role: 'owner' }] : [],
      )
      tx.household.findUnique.mockResolvedValue({ id: 'hh-A', name: 'Alpha', preferences: null })
      installTx(tx)

      const hh = await exportHousehold()

      expect(hh.ingredients).toEqual([])
      expect(hh.referencedGlobalIngredients).toEqual([])
      expect(tx.ingredient.findMany).toHaveBeenCalledTimes(1)
    })
  })
})
