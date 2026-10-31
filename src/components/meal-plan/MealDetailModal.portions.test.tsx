import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryWrapper } from '@/test/query-wrapper'

import { MealDetailModal } from './MealDetailModal'
import type { MealData } from './types'

// The nutrition chips through the real members query and `MealDetail`
// (HON-1475). The other modal tests mock the query, so these live apart.

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('@/lib/auth-client', () => ({ authClient: { getSession } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/hooks/use-meal-image', () => ({
  useMealImage: () => ({ status: 'none', imageUrl: null, imageHue: null, cancelImage: vi.fn() }),
}))
vi.mock('@/hooks/use-wake-lock', () => ({ useWakeLock: () => {} }))
vi.mock('./NoteEditor', () => ({ NoteEditor: () => null }))
vi.mock('./MealImage', () => ({ MealImage: () => null }))

const MEMBERS_URL = '/api/households/me/members'

const meal: MealData = {
  id: 'meal-1',
  name: 'Trout with potatoes',
  kidFriendly: false,
  components: [],
  nutrition: { calories: 520, protein: 38, carbs: 30, fat: 22 },
}

const member = (id: string, userId: string | null, name: string, portionMultiplier: number) => ({
  id,
  userId,
  name,
  role: 'member',
  joinedAt: '2026-01-01T00:00:00.000Z',
  user: null,
  preferences: { displayName: null, portionMultiplier },
  invite: null,
})

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  getSession.mockReset()
  getSession.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  fetchMock = vi.fn((url: string) =>
    Promise.resolve(
      new Response(
        JSON.stringify(
          url === MEMBERS_URL
            ? {
                householdId: 'h1',
                members: [
                  member('m1', 'u1', 'Kaupo', 1.5),
                  member('m2', 'u2', 'Mari', 1),
                  member('m3', null, 'Nora', 0.5),
                ],
              }
            : { ok: true },
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const membersRequests = () => fetchMock.mock.calls.filter(([url]) => url === MEMBERS_URL)

describe('MealDetailModal portion nutrition (HON-1475, HON-1505)', () => {
  it("opens a planned meal on the signed-in member's 1.5× plate", async () => {
    const { wrapper } = createQueryWrapper()
    render(
      <MealDetailModal
        meal={meal}
        householdServings={3}
        status="planned"
        open
        onOpenChange={vi.fn()}
        planId="plan-1"
        entryId="entry-1"
        initialSteps={{ equipment: [], steps: ['Bake the trout'], pitfalls: [] }}
      />,
      { wrapper },
    )
    expect(
      await screen.findByRole('combobox', { name: 'Whose portion Kaupo, 1.5× portion' }),
    ).toBeInTheDocument()
    expect(screen.getByText('57g')).toBeInTheDocument()
  })

  it('asks for no members on the read-only landing deck', async () => {
    const { wrapper } = createQueryWrapper()
    render(
      <MealDetailModal
        meal={meal}
        householdServings={3}
        open
        onOpenChange={vi.fn()}
        initialSteps={{ equipment: [], steps: ['Bake the trout'], pitfalls: [] }}
        readOnly
      />,
      { wrapper },
    )
    // Let any query that would start run its first fetch.
    await waitFor(() => expect(screen.getByText('per serving')).toBeInTheDocument())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(membersRequests()).toHaveLength(0)
    expect(getSession).not.toHaveBeenCalled()
    expect(screen.queryByRole('combobox', { name: /^Whose portion/ })).not.toBeInTheDocument()
  })
})
