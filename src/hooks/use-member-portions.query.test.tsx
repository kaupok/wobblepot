import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryWrapper } from '@/test/query-wrapper'

const { apiFetch, getSession } = vi.hoisted(() => ({ apiFetch: vi.fn(), getSession: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiFetch }))
vi.mock('@/lib/auth-client', () => ({ authClient: { getSession } }))

import { useMemberPortions } from './use-member-portions'

describe('useMemberPortions', () => {
  beforeEach(() => {
    apiFetch.mockReset()
    getSession.mockReset()
  })

  it('makes no request when turned off, as on the landing deck', () => {
    const { result } = renderHook(() => useMemberPortions(false), {
      wrapper: createQueryWrapper().wrapper,
    })
    expect(result.current).toBeUndefined()
    expect(apiFetch).not.toHaveBeenCalled()
    expect(getSession).not.toHaveBeenCalled()
  })

  it("returns each member's portion and marks the signed-in user", async () => {
    apiFetch.mockResolvedValue({
      householdId: 'h1',
      members: [
        {
          id: 'm1',
          userId: 'u1',
          name: 'Kaupo',
          role: 'owner',
          joinedAt: '2026-01-01T00:00:00.000Z',
          user: null,
          preferences: { displayName: null, portionMultiplier: 1.5 },
          invite: null,
        },
      ],
    })
    getSession.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })

    const { result } = renderHook(() => useMemberPortions(true), {
      wrapper: createQueryWrapper().wrapper,
    })
    await waitFor(() =>
      expect(result.current).toEqual([{ id: 'm1', name: 'Kaupo', multiplier: 1.5, isSelf: true }]),
    )
    expect(apiFetch).toHaveBeenCalledWith('/api/households/me/members')
  })

  it('returns nothing when the members fail to load', async () => {
    apiFetch.mockRejectedValue(new Error('500'))
    getSession.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })

    const { wrapper, queryClient } = createQueryWrapper()
    const { result } = renderHook(() => useMemberPortions(true), { wrapper })
    await waitFor(() => {
      expect(queryClient.getQueryState(['household-members'])?.status).toBe('error')
      expect(queryClient.getQueryState(['auth-session'])?.status).toBe('success')
    })
    expect(result.current).toBeUndefined()
  })
})
