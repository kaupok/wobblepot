import { beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from './route'

// "Cook for tomorrow's lunch too" (HON-1396). The rules are `addLeftoverLunch`,
// tested against a database in `leftover-lunch.db.test.ts`; this file asserts
// the validation and the answers the route maps.

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

vi.mock('@/lib/meal-plans/leftover-lunch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/leftover-lunch')>()),
  addLeftoverLunch: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { EntryCreateError } from '@/lib/meal-plans/create-entry'
import { addLeftoverLunch, LeftoverLunchError } from '@/lib/meal-plans/leftover-lunch'

const mockAdd = vi.mocked(addLeftoverLunch)
const household = { id: 'household-123', preferences: null }

async function post(body: unknown) {
  const res = await POST(
    new Request('http://localhost/api/meal-plans/plan-123/entries/entry-123/leftover-lunch', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'plan-123', entryId: 'entry-123' }) },
  )
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: 'user-123' } } as never)
  vi.mocked(getHouseholdMembership).mockResolvedValue({ household } as never)
})

describe('POST leftover-lunch', () => {
  it('answers 401 without a session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never)
    expect((await post({ servings: 2.5 })).status).toBe(401)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('adds the lunch with the servings sent', async () => {
    mockAdd.mockResolvedValue({ outcome: 'planned', date: '2026-10-22' })

    expect(await post({ servings: 2.5 })).toEqual({
      status: 200,
      body: { outcome: 'planned', date: '2026-10-22' },
    })
    expect(mockAdd).toHaveBeenCalledWith(household, 'plan-123', 'entry-123', 2.5)
  })

  it.each([
    ['no servings', {}],
    ['0 servings', { servings: 0 }],
    ['21 servings', { servings: 21 }],
    ['a step that is not 0.5', { servings: 1.3 }],
    ['another field', { servings: 1, mealType: 'lunch' }],
  ])('answers 400 for %s', async (_case, body) => {
    expect((await post(body)).status).toBe(400)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('answers 404 for a dinner the household may not see', async () => {
    mockAdd.mockRejectedValue(new LeftoverLunchError('dinnerNotFound'))
    expect((await post({ servings: 1 })).status).toBe(404)
  })

  it.each([
    'notPlannedDinner',
    'lunchOff',
    'recipeLunch',
    'cooked',
    'alreadyLinked',
    'lunchFull',
  ] as const)('answers 409 with code %s, unreported', async (reason) => {
    mockAdd.mockRejectedValue(new LeftoverLunchError(reason))

    const { status, body } = await post({ servings: 1 })

    expect(status).toBe(409)
    expect(body.code).toBe(reason)
    expect(captureApiError).not.toHaveBeenCalled()
  })

  it('answers 409 lunchChanged when the slot filled between the read and the write', async () => {
    mockAdd.mockRejectedValue(new EntryCreateError('slotTaken'))
    expect(await post({ servings: 1 })).toEqual({
      status: 409,
      body: { error: 'The lunch changed meanwhile', code: 'lunchChanged' },
    })
  })

  it('answers 500 and reports an unexpected failure', async () => {
    mockAdd.mockRejectedValue(new Error('boom'))
    expect((await post({ servings: 1 })).status).toBe(500)
    expect(captureApiError).toHaveBeenCalledTimes(1)
  })
})
