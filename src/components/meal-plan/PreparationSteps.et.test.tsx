import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Real next-intl, so the Estonian catalog is what renders. The global mock
// resolves every key against en.json whatever the provider's locale.
vi.unmock('next-intl')
import { render, screen, fireEvent, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import etMessages from '../../../messages/et.json'
import { createQueryWrapper } from '@/test/query-wrapper'
import { useMealSteps } from '@/hooks/use-meal-steps'
import { PreparationEquipment, PreparationSteps } from './PreparationSteps'

/** The English prose the tips route puts in `data.error` on an entry 404. */
const SERVER_PROSE = 'Entry not found'

/** The hook and the component as `MealDetailModal` wires them. */
function StepsHarness() {
  const { steps, isLoadingSteps, stepsError, fetchSteps } = useMealSteps({
    planId: 'plan-1',
    entryId: 'entry-1',
  })
  return (
    <>
      <button type="button" onClick={fetchSteps}>
        load
      </button>
      <PreparationEquipment equipment={steps?.equipment} />
      <PreparationSteps
        steps={steps}
        isLoading={isLoadingSteps}
        error={stepsError}
        onRetry={fetchSteps}
      />
    </>
  )
}

function renderInEstonian() {
  const { wrapper: QueryWrapper } = createQueryWrapper()
  return render(
    <QueryWrapper>
      <NextIntlClientProvider locale="et" messages={etMessages}>
        <StepsHarness />
      </NextIntlClientProvider>
    </QueryWrapper>,
  )
}

describe('PreparationSteps in an Estonian household (HON-888)', () => {
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
      await screen.findByText(etMessages['meal-plan'].steps.errors.entryNotFound),
    ).toBeInTheDocument()
    expect(screen.queryByText(SERVER_PROSE)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: etMessages['meal-plan'].steps.retry }),
    ).toBeInTheDocument()
  })

  it('shows Estonian copy for a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    renderInEstonian()
    fireEvent.click(screen.getByRole('button', { name: 'load' }))

    expect(
      await screen.findByText(etMessages['meal-plan'].steps.errors.tipsFailed),
    ).toBeInTheDocument()
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument()
  })

  it('renders the loaded tips under the Estonian headings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            tips: {
              equipment: ['Pann', 'Lõikelaud'],
              steps: ['Tükelda köögiviljad'],
              pitfalls: ['Ära küpseta kana üle'],
              tip: 'Lase lihal puhata.',
            },
          }),
      }),
    )

    renderInEstonian()
    fireEvent.click(screen.getByRole('button', { name: 'load' }))

    const equipment = await screen.findByRole('list', { name: 'Vaja läheb' })
    expect(
      within(equipment)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Pann', 'Lõikelaud'])
    expect(screen.getByRole('heading', { name: 'Tähelepanu' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Nõuanne' })).toBeInTheDocument()
  })
})
