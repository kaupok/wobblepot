import { describe, it, expect, vi, beforeEach } from 'vitest'

// `RATE_LIMIT_BYPASS_ACTIVE` is computed once at module init, so we mock the
// module and re-import the route under each gate value — same shape as
// `src/app/api/e2e-seed/route.test.ts`.
const setBypass = (active: boolean) => {
  vi.doMock('@/lib/rate-limit', () => ({ RATE_LIMIT_BYPASS_ACTIVE: active }))
}

const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  verification: {
    findFirst: vi.fn(),
  },
  householdMember: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  session: { count: vi.fn() },
  household: { count: vi.fn(), findUnique: vi.fn() },
  pantryItem: { count: vi.fn() },
  mealPlan: { count: vi.fn() },
}

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

const url = (qs: string) => `http://localhost/api/e2e-support${qs}`

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mockPrisma.session.count.mockResolvedValue(0)
  mockPrisma.household.count.mockResolvedValue(0)
  mockPrisma.pantryItem.count.mockResolvedValue(0)
  mockPrisma.mealPlan.count.mockResolvedValue(0)
  mockPrisma.householdMember.findMany.mockResolvedValue([])
})

describe('/api/e2e-support — production gate', () => {
  it('GET returns 404 when RATE_LIMIT_BYPASS_ACTIVE is false (production / staging / preview)', async () => {
    setBypass(false)
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=user-state&email=a@b.c')))
    expect(res.status).toBe(404)
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('POST returns 404 when RATE_LIMIT_BYPASS_ACTIVE is false', async () => {
    setBypass(false)
    const { POST } = await import('./route')

    const res = await POST(new Request(url('?action=expire-purge&email=a@b.c'), { method: 'POST' }))
    expect(res.status).toBe(404)
    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled()
  })
})

describe('GET /api/e2e-support?action=reset-token', () => {
  beforeEach(() => setBypass(true))

  it('returns 400 when email is missing', async () => {
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=reset-token')))
    expect(res.status).toBe(400)
  })

  it('returns 404 when the user does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null)
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=reset-token&email=nobody@example.com')))
    expect(res.status).toBe(404)
  })

  it('returns 404 when the user has no pending reset token', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' })
    mockPrisma.verification.findFirst.mockResolvedValue(null)
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=reset-token&email=a@b.c')))
    expect(res.status).toBe(404)
  })

  it('strips the reset-password: prefix and returns the Better Auth callback path', async () => {
    const expiresAt = new Date(Date.now() + 3_600_000)
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' })
    mockPrisma.verification.findFirst.mockResolvedValue({
      identifier: 'reset-password:tok-123',
      expiresAt,
    })
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=reset-token&email=a@b.c')))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token).toBe('tok-123')
    expect(body.resetPath).toBe('/api/auth/reset-password/tok-123?callbackURL=%2Freset-password')

    // Only unexpired tokens belonging to this user are eligible.
    const where = mockPrisma.verification.findFirst.mock.calls[0]![0].where
    expect(where.value).toBe('u1')
    expect(where.identifier).toEqual({ startsWith: 'reset-password:' })
    expect(where.expiresAt.gt).toBeInstanceOf(Date)
  })
})

describe('GET /api/e2e-support?action=user-state', () => {
  beforeEach(() => setBypass(true))

  it('reports exists: false for a purged account', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null)
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=user-state&email=gone@example.com')))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ exists: false })
  })

  it('returns soft-delete columns and related row counts', async () => {
    const deletedAt = new Date('2026-08-01T00:00:00.000Z')
    const purgeScheduledFor = new Date('2026-08-31T03:00:00.000Z')
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', deletedAt, purgeScheduledFor })
    mockPrisma.householdMember.findMany.mockResolvedValue([{ householdId: 'h1' }])
    mockPrisma.session.count.mockResolvedValue(0)
    mockPrisma.household.count.mockResolvedValue(1)
    mockPrisma.pantryItem.count.mockResolvedValue(3)
    mockPrisma.mealPlan.count.mockResolvedValue(1)
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=user-state&email=a@b.c')))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      exists: true,
      deletedAt: deletedAt.toISOString(),
      purgeScheduledFor: purgeScheduledFor.toISOString(),
      householdIds: ['h1'],
      sessions: 0,
      memberships: 1,
      households: 1,
      pantryItems: 3,
      mealPlans: 1,
    })
  })

  it('skips household-scoped counts when the user has no memberships', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      deletedAt: null,
      purgeScheduledFor: null,
    })
    mockPrisma.householdMember.findMany.mockResolvedValue([])
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=user-state&email=a@b.c')))
    const body = await res.json()
    expect(body).toMatchObject({ exists: true, memberships: 0, households: 0, pantryItems: 0 })
    expect(mockPrisma.household.count).not.toHaveBeenCalled()
    expect(mockPrisma.pantryItem.count).not.toHaveBeenCalled()
  })

  it('rejects an unknown action', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null)
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=drop-tables&email=a@b.c')))
    expect(res.status).toBe(400)
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
  })
})

describe('GET /api/e2e-support?action=household-state', () => {
  beforeEach(() => setBypass(true))

  it('requires householdId rather than email', async () => {
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=household-state')))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Missing ?householdId=<value>' })
  })

  it('reports a purged household as gone', async () => {
    mockPrisma.household.findUnique.mockResolvedValue(null)
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=household-state&householdId=h1')))
    expect(res.status).toBe(200)
    // Bare shape, same as user-state: no fabricated zero counts for a row
    // that no longer exists.
    expect(await res.json()).toEqual({ exists: false })
    // No point counting rows that cascade-deleted with the household.
    expect(mockPrisma.householdMember.count).not.toHaveBeenCalled()
  })

  it('counts household-scoped rows while the household survives', async () => {
    mockPrisma.household.findUnique.mockResolvedValue({ id: 'h1' })
    mockPrisma.householdMember.count.mockResolvedValue(2)
    mockPrisma.pantryItem.count.mockResolvedValue(5)
    mockPrisma.mealPlan.count.mockResolvedValue(1)
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=household-state&householdId=h1')))
    expect(await res.json()).toEqual({
      exists: true,
      members: 2,
      pantryItems: 5,
      mealPlans: 1,
    })
  })
})

describe('POST /api/e2e-support?action=expire-purge', () => {
  beforeEach(() => setBypass(true))

  it('back-dates purgeScheduledFor only for a soft-deleted account', async () => {
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 })
    const { POST } = await import('./route')

    const res = await POST(new Request(url('?action=expire-purge&email=a@b.c'), { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, updated: 1 })

    const args = mockPrisma.user.updateMany.mock.calls[0]![0]
    expect(args.where).toEqual({ email: 'a@b.c', deletedAt: { not: null } })
    expect(args.data.purgeScheduledFor.getTime()).toBeLessThan(Date.now())
  })

  it('returns 404 when no soft-deleted user matches (live accounts are untouchable)', async () => {
    mockPrisma.user.updateMany.mockResolvedValue({ count: 0 })
    const { POST } = await import('./route')

    const res = await POST(
      new Request(url('?action=expire-purge&email=live@example.com'), { method: 'POST' }),
    )
    expect(res.status).toBe(404)
  })

  it('rejects an unknown action', async () => {
    const { POST } = await import('./route')

    const res = await POST(new Request(url('?action=nuke&email=a@b.c'), { method: 'POST' }))
    expect(res.status).toBe(400)
    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled()
  })
})
