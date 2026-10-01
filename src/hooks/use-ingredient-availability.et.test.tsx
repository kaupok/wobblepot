import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'

// The global next-intl mock resolves against the English catalog only, which
// would pass whether or not the route's English `error` leaks (HON-914).
vi.unmock('next-intl')
import { act, renderHook, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { toast } from 'sonner'
import etMessages from '../../messages/et.json'
import { createQueryWrapper } from '@/test/query-wrapper'
import { useIngredientAvailability } from './use-ingredient-availability'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

function respondWith(body: Record<string, unknown>, status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
}

function renderAvailability() {
  const { wrapper: QueryWrapper } = createQueryWrapper()
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale="et" messages={etMessages}>
        <QueryWrapper>{children}</QueryWrapper>
      </NextIntlClientProvider>
    )
  }
  return renderHook(() => useIngredientAvailability({ onRefresh: vi.fn() }), { wrapper: Wrapper })
}

describe('useIngredientAvailability in Estonian', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('toasts the Estonian add failure, not the route error', async () => {
    respondWith({ error: 'Failed to add pantry item' }, 500)
    const { result } = renderAvailability()

    act(() => result.current.handleToggleAvailability('ing-1', true))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(etMessages.pantry.errors.addFailed)
    })
  })

  it('toasts the Estonian remove failure, not the route error', async () => {
    respondWith({ error: 'Failed to delete pantry item' }, 500)
    const { result } = renderAvailability()

    act(() => result.current.handleToggleAvailability('ing-1', false))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(etMessages.pantry.errors.removeFailed)
    })
  })
})
