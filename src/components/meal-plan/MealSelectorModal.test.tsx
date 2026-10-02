import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// The global next-intl mock resolves every key against the English catalogue,
// so it cannot tell a translated string from an untranslated one — which is the
// bug under test (HON-724). Use the real provider so the `et` assertions mean
// something.
vi.unmock('next-intl')
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { toast } from 'sonner'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { MealSelectorModal } from './MealSelectorModal'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

// The list and the imagine panel have their own tests; here they only need to
// hand the modal a meal id, which is what triggers the PATCH under test.
const hookState = vi.hoisted(() => ({ isRateLimited: false, isSearchMode: false }))

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
    isSearchMode: hookState.isSearchMode,
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
  ImaginePanel: ({
    mealType,
    onExit,
    onMealSaved,
  }: {
    mealType: string
    onExit: () => void
    onMealSaved: (mealId: string) => void
  }) => (
    <div data-testid="imagine-panel" data-meal-type={mealType}>
      <button onClick={() => onMealSaved('meal-1')}>save imagined meal</button>
      <button onClick={onExit}>back to library</button>
    </div>
  ),
}))

/** Verbatim from the plan-entry PATCH route's 404 branch. */
const SERVER_PROSE = 'Entry not found or access denied'

type ModalProps = React.ComponentProps<typeof MealSelectorModal>

function renderModal(
  props: Partial<Pick<ModalProps, 'mode' | 'date' | 'relativeDay' | 'mealType'>> = {},
  { locale = 'et' }: { locale?: 'en' | 'et' } = {},
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? enMessages : etMessages}>
      <MealSelectorModal
        open
        onOpenChange={vi.fn()}
        planId="plan-1"
        entryId="entry-1"
        mealType="dinner"
        householdSize={4}
        onSwapComplete={vi.fn()}
        mode="add"
        {...props}
      />
    </NextIntlClientProvider>,
  )
}

/**
 * The title's two forms, short (below `md`) then long. Both are in the DOM and
 * CSS hides one; jsdom loads no CSS, so each is read from its own span.
 */
function titleForms() {
  const [short, long] = Array.from(screen.getByRole('heading').children)
  return { short: short?.textContent, long: long?.textContent, shortEl: short!, longEl: long! }
}

/** 2026-10-08 is a Thursday. */
const THURSDAY = '2026-10-08'

describe('MealSelectorModal slot title', () => {
  // The dialog covers the timeline row that was tapped, so in add mode its
  // title names the slot in one sentence (HON-807, HON-941).
  it('names a dated slot in English, long and short', () => {
    renderModal({ date: THURSDAY, mealType: 'breakfast' }, { locale: 'en' })

    const { short, long, shortEl, longEl } = titleForms()
    expect(long).toBe('Pick a breakfast for Thursday Oct 8')
    expect(short).toBe('Breakfast for Thu Oct 8')
    expect(shortEl).toHaveClass('md:hidden')
    expect(longEl).toHaveClass('hidden', 'md:inline')
  })

  it('dims only the date', () => {
    renderModal({ date: THURSDAY, mealType: 'breakfast' }, { locale: 'en' })

    const { shortEl, longEl } = titleForms()
    for (const form of [shortEl, longEl]) {
      const dimmed = form.querySelectorAll('.text-muted-foreground')
      expect(dimmed).toHaveLength(1)
      expect(dimmed[0]).toHaveTextContent(/^Oct 8$/)
      expect(dimmed[0]).toHaveClass('font-normal')
    }
  })

  it('names lunch and dinner slots with their own label', () => {
    renderModal({ date: THURSDAY, mealType: 'lunch' }, { locale: 'en' })
    expect(titleForms().long).toBe('Pick a lunch for Thursday Oct 8')
    expect(titleForms().short).toBe('Lunch for Thu Oct 8')
  })

  it.each([
    ['today', 'Pick a dinner for today', 'Dinner for today'],
    ['tomorrow', 'Pick a dinner for tomorrow', 'Dinner for tomorrow'],
  ] as const)('says %s rather than the date', (relativeDay, long, short) => {
    renderModal({ date: THURSDAY, relativeDay }, { locale: 'en' })

    expect(titleForms()).toMatchObject({ long, short })
    expect(screen.getByRole('heading').querySelector('.text-muted-foreground')).toBeNull()
  })

  // Estonian joins with a separator rather than "for", which would need the
  // weekday declined ("neljapäevaks").
  it('uses the separator form in Estonian', () => {
    renderModal({ date: THURSDAY })

    expect(titleForms()).toMatchObject({
      long: 'Vali õhtusöök: neljapäev 8. okt',
      short: 'Õhtusöök: N 8. okt',
    })
  })

  it('uses the Estonian relative day', () => {
    renderModal({ date: THURSDAY, relativeDay: 'today' })

    expect(titleForms()).toMatchObject({ long: 'Vali õhtusöök: täna', short: 'Õhtusöök: täna' })
  })

  it('renders no description, and nothing points at one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderModal({ date: THURSDAY })

    const dialog = screen.getByRole('dialog')
    expect(dialog).not.toHaveAttribute('aria-describedby')
    expect(dialog).toHaveAccessibleDescription('')
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('keeps the generic add copy without the date', () => {
    renderModal()

    expect(screen.getByRole('heading')).toHaveTextContent(etMessages['meal-plan'].selector.addTitle)
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      etMessages['meal-plan'].selector.addDescription,
    )
  })

  it('ignores the date in swap mode', () => {
    renderModal({ mode: 'swap', date: THURSDAY })

    expect(screen.getByRole('heading')).toHaveTextContent(
      etMessages['meal-plan'].selector.swapTitle,
    )
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      etMessages['meal-plan'].selector.swapDescriptionGeneric,
    )
  })
})

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

describe('MealSelectorModal accessible names', () => {
  const selector = etMessages['meal-plan'].selector

  // getByLabelText matches aria-label but not a placeholder or a title, so
  // both assertions fail against a field or button named only by those (HON-808).
  it('names the library search independently of its placeholder', () => {
    renderModal()

    expect(screen.getByLabelText(selector.searchAria)).toHaveAttribute(
      'placeholder',
      selector.searchPlaceholder,
    )
  })

  // The label is visible text, so it is the name; no aria-label to drift
  // from it, and no title (HON-808, HON-945).
  it('names the imagine button by its visible label', () => {
    renderModal()

    const button = screen.getByRole('button', { name: selector.imagineButton })
    expect(button).toHaveTextContent(selector.imagineButton)
    expect(button).not.toHaveAttribute('aria-label')
    expect(button).not.toHaveAttribute('title')
  })
})

describe('MealSelectorModal empty search', () => {
  beforeEach(() => {
    hookState.isSearchMode = true
  })

  afterEach(() => {
    hookState.isSearchMode = false
  })

  function search(query: string, locale: 'en' | 'et') {
    const messages = locale === 'en' ? enMessages : etMessages
    fireEvent.change(screen.getByLabelText(messages['meal-plan'].selector.searchAria), {
      target: { value: query },
    })
  }

  // Empty states say what is true, then what to do next (docs/DESIGN.md → Copy).
  it('says nothing matched, then offers to imagine one', () => {
    renderModal({}, { locale: 'en' })
    search('qqqq', 'en')

    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === 'P' &&
          el.textContent === 'No meals found matching "qqqq". Try another word, or imagine one.',
      ),
    ).toBeInTheDocument()
  })

  it('opens the imagine panel for the slot and keeps the search for the way back', () => {
    renderModal({ mealType: 'breakfast' }, { locale: 'en' })
    search('qqqq', 'en')

    fireEvent.click(screen.getByRole('button', { name: 'imagine one' }))
    expect(screen.getByTestId('imagine-panel')).toHaveAttribute('data-meal-type', 'breakfast')

    fireEvent.click(screen.getByRole('button', { name: 'back to library' }))
    expect(screen.getByLabelText(enMessages['meal-plan'].selector.searchAria)).toHaveValue('qqqq')
  })

  it('offers the same action in Estonian', () => {
    renderModal()
    search('qqqq', 'et')

    fireEvent.click(screen.getByRole('button', { name: 'mõtle üks välja' }))
    expect(screen.getByTestId('imagine-panel')).toBeInTheDocument()
  })

  it('names "My recipes only" as the thing to change when it is on', () => {
    renderModal({}, { locale: 'en' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'My recipes only' }))
    search('qqqq', 'en')

    expect(
      screen.getByText(
        'No custom recipes found matching "qqqq". Try another word, or turn off "My recipes only".',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'imagine one' })).not.toBeInTheDocument()
  })
})
