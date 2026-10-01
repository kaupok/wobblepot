import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Real next-intl, so the Estonian catalog is what renders. The global mock
// resolves every key against en.json whatever the provider's locale.
vi.unmock('next-intl')
import { render, screen, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import etMessages from '../../../messages/et.json'
import { createQueryWrapper } from '@/test/query-wrapper'
import { useMealTips } from '@/hooks/use-meal-tips'
import { PreparationTips } from './PreparationTips'

/** The English prose the tips route puts in `data.error` on an entry 404. */
const SERVER_PROSE = 'Entry not found'

/** The hook and the component as `MealDetailModal` wires them. */
function TipsHarness() {
  const { tips, isLoadingTips, tipsError, fetchTips } = useMealTips({
    planId: 'plan-1',
    entryId: 'entry-1',
  })
  return (
    <>
      <button type="button" onClick={fetchTips}>
        load
      </button>
      <PreparationTips
        tips={tips}
        isLoading={isLoadingTips}
        error={tipsError}
        onRetry={fetchTips}
      />
    </>
  )
}

function renderInEstonian() {
  const { wrapper: QueryWrapper } = createQueryWrapper()
  return render(
    <QueryWrapper>
      <NextIntlClientProvider locale="et" messages={etMessages}>
        <TipsHarness />
      </NextIntlClientProvider>
    </QueryWrapper>,
  )
}

describe('PreparationTips in an Estonian household (HON-888)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows Estonian catalog copy for a failed request, not the route prose', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: SERVER_PROSE, code: 'entry_not_found' }),
      }),
    )

    renderInEstonian()
    fireEvent.click(screen.getByRole('button', { name: 'load' }))

    expect(
      await screen.findByText(etMessages['meal-plan'].tips.errors.entryNotFound),
    ).toBeInTheDocument()
    expect(screen.queryByText(SERVER_PROSE)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: etMessages['meal-plan'].tips.retry }),
    ).toBeInTheDocument()
  })

  it('shows Estonian copy for a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    renderInEstonian()
    fireEvent.click(screen.getByRole('button', { name: 'load' }))

    expect(
      await screen.findByText(etMessages['meal-plan'].tips.errors.tipsFailed),
    ).toBeInTheDocument()
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument()
  })
})
