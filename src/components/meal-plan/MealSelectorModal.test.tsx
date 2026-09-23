import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// The global next-intl mock resolves every key against the English catalogue,
// so it cannot tell a translated string from an untranslated one — which is the
// bug under test (HON-724). Use the real provider so the `et` assertions mean
// something.
vi.unmock('next-intl')
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { toast } from 'sonner'
import etMessages from '../../../messages/et.json'
import { MealSelectorModal } from './MealSelectorModal'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

// The list and the imagine panel have their own tests; here they only need to
// hand the modal a meal id, which is what triggers the PATCH under test.
const hookState = vi.hoisted(() => ({ isRateLimited: false }))

vi.mock('./meal-selector/use-meal-alternatives', () => ({
  useMealAlternatives: () => ({
    displayedMeals: [],
    isLoading: false,
    isFetchingMore: false,
    hasMore: false,
    loadMore: vi.fn(),
    reset: vi.fn(),
    total: 0,
    hasLoadedList: true,
    isSearchMode: false,
    isMyRecipesBrowseMode: false,
    isRateLimited: hookState.isRateLimited,
  }),
}))

vi.mock('./meal-selector/AlternativesList', () => ({
  AlternativesList: ({
    error,
    emptyState,
    onSelect,
  }: {
    error: string | null
    emptyState: React.ReactNode
    onSelect: (mealId: string) => void
  }) => (
    <div>
      {error && <p role="alert">{error}</p>}
      {emptyState}
      <button onClick={() => onSelect('meal-2')}>pick meal</button>
    </div>
  ),
}))

vi.mock('./meal-selector/ImaginePanel', () => ({
  ImaginePanel: ({ onMealSaved }: { onMealSaved: (mealId: string) => void }) => (
    <button onClick={() => onMealSaved('meal-1')}>save imagined meal</button>
  ),
}))

/** Verbatim from the plan-entry PATCH route's 404 branch. */
const SERVER_PROSE = 'Entry not found or access denied'

function renderModal() {
  return render(
    <NextIntlClientProvider locale="et" messages={etMessages}>
      <MealSelectorModal
        open
        onOpenChange={vi.fn()}
        planId="plan-1"
        entryId="entry-1"
        mealType="dinner"
        householdSize={4}
        onSwapComplete={vi.fn()}
        mode="add"
      />
    </NextIntlClientProvider>,
  )
}

describe('MealSelectorModal plan-assignment error localization', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: SERVER_PROSE }),
        }),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.mocked(toast.error).mockClear()
  })

  it('toasts Estonian, not the server prose, when assigning an imagined meal fails', async () => {
    renderModal()
    fireEvent.click(
      screen.getByRole('button', { name: etMessages['meal-plan'].selector.imagineButton }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'save imagined meal' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        etMessages['meal-plan'].selector.imagine.assignFailed,
      ),
    )
    expect(toast.error).not.toHaveBeenCalledWith(SERVER_PROSE)
    expect(consoleError).toHaveBeenCalledWith(
      '[meal-selector] plan entry update failed',
      expect.objectContaining({ status: 404, error: SERVER_PROSE }),
    )
  })

  it('renders Estonian, not the server prose, when selecting a meal fails', async () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'pick meal' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      etMessages['meal-plan'].selector.updateMealFailed,
    )
    expect(screen.queryByText(SERVER_PROSE)).not.toBeInTheDocument()
    expect(consoleError).toHaveBeenCalledWith(
      '[meal-selector] plan entry update failed',
      expect.objectContaining({ status: 404, error: SERVER_PROSE }),
    )
  })
})

describe('MealSelectorModal suggestions rate limit', () => {
  afterEach(() => {
    hookState.isRateLimited = false
  })

  it('explains a rate-limited suggestions request in Estonian instead of "no suggestions"', () => {
    hookState.isRateLimited = true
    renderModal()

    expect(screen.getByText(etMessages['meal-plan'].selector.rateLimited)).toBeInTheDocument()
    expect(
      screen.queryByText(etMessages['meal-plan'].selector.noSuggestions),
    ).not.toBeInTheDocument()
  })

  it('keeps the "no suggestions" copy when the request was not rate limited', () => {
    renderModal()

    expect(screen.getByText(etMessages['meal-plan'].selector.noSuggestions)).toBeInTheDocument()
  })
})
