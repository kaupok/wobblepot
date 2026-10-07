import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The global next-intl mock resolves against the English catalog only, which
// would pass whether or not the route's English `error` leaks (HON-914).
vi.unmock('next-intl')
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { toast } from 'sonner'
import etMessages from '../../../messages/et.json'
import { createQueryWrapper } from '@/test/query-wrapper'
import { TimelineEmptySlot } from './TimelineEmptySlot'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

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

function renderSlot() {
  const { wrapper: QueryWrapper } = createQueryWrapper()
  return render(
    <QueryWrapper>
      <NextIntlClientProvider locale="et" messages={etMessages}>
        <TimelineEmptySlot
          planId="plan-1"
          date="2026-04-16"
          dayLabel="Neljapäev"
          mealType="dinner"
          householdServings={2}
        />
      </NextIntlClientProvider>
    </QueryWrapper>,
  )
}

describe('TimelineEmptySlot in Estonian', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('toasts the duplicate-slot copy for a 409, not the route error', async () => {
    respondWith({ error: 'Entry already exists for this date and meal type' }, 409)
    renderSlot()

    await userEvent.click(screen.getByRole('button', { name: /^Õhtusöök: vali toit, Neljapäev$/ }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(etMessages['meal-plan'].card.entryAlreadyExists)
    })
  })

  it('toasts the generic failure for any other status', async () => {
    respondWith({ error: 'Validation failed' }, 400)
    renderSlot()

    await userEvent.click(screen.getByRole('button', { name: /^Õhtusöök: vali toit, Neljapäev$/ }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(etMessages['meal-plan'].card.createEntryFailed)
    })
  })
})
