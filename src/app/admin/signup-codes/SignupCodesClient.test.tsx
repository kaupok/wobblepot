import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { SignupCodesClient, type SignupCodeRow } from './SignupCodesClient'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const initial: SignupCodeRow[] = [
  {
    id: 'row-1',
    code: 'unused-code-1',
    createdAt: '2026-04-25T12:00:00.000Z',
    usedAt: null,
    expiresAt: null,
    note: 'For Anna',
    usedByEmail: null,
  },
  {
    id: 'row-2',
    code: 'used-code-1',
    createdAt: '2026-04-25T11:00:00.000Z',
    usedAt: '2026-04-25T11:30:00.000Z',
    expiresAt: null,
    note: null,
    usedByEmail: 'someone@example.com',
  },
]

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('SignupCodesClient', () => {
  it('renders the initial codes and disables revoke for used codes', () => {
    const { wrapper } = createQueryWrapper()
    render(<SignupCodesClient initialCodes={initial} />, { wrapper })

    expect(screen.getByText('unused-code-1')).toBeInTheDocument()
    expect(screen.getByText('used-code-1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /revoke code unused-code-1/i })).toBeInTheDocument()
    // Used code does not get a revoke button.
    expect(
      screen.queryByRole('button', { name: /revoke code used-code-1/i }),
    ).not.toBeInTheDocument()
  })

  it('mints a new code via POST and refreshes the list', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.endsWith('/api/admin/signup-codes') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            code: {
              id: 'row-3',
              code: 'fresh-code',
              createdAt: '2026-04-25T13:00:00.000Z',
              usedAt: null,
              expiresAt: null,
              note: 'New',
              usedByEmail: null,
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        )
      }
      // GET refresh after mutation success.
      return new Response(
        JSON.stringify({
          codes: [
            {
              id: 'row-3',
              code: 'fresh-code',
              createdAt: '2026-04-25T13:00:00.000Z',
              usedAt: null,
              expiresAt: null,
              note: 'New',
              usedByEmail: null,
            },
            ...initial,
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { wrapper } = createQueryWrapper()
    render(<SignupCodesClient initialCodes={initial} />, { wrapper })

    await user.click(screen.getByRole('button', { name: 'Create code' }))

    await waitFor(() => {
      expect(screen.getByText('fresh-code')).toBeInTheDocument()
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/signup-codes',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('revokes a code via DELETE and refreshes the list', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/admin/signup-codes/') && init?.method === 'DELETE') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ codes: [initial[1]] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { wrapper } = createQueryWrapper()
    render(<SignupCodesClient initialCodes={initial} />, { wrapper })

    await user.click(screen.getByRole('button', { name: /revoke code unused-code-1/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/signup-codes/row-1',
        expect.objectContaining({ method: 'DELETE' }),
      )
    })
  })
})
