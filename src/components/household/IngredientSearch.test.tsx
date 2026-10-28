import type { ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { dropFocusToBody } from '@/test/focus'
import { IngredientSearch } from './IngredientSearch'
import type { IngredientResult } from './meal-form-types'

const mockIngredients: IngredientResult[] = [
  { id: '1', name: 'Tomato', category: 'vegetable', defaultUnit: 'g' },
  { id: '2', name: 'Tofu', category: 'protein', defaultUnit: 'g' },
]

function mockFetchSuccess(ingredients: IngredientResult[]) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ ingredients }),
  })
}

/** The component reads through `useIngredientSearch`, so it needs a query client. */
function renderSearch(props: Partial<ComponentProps<typeof IngredientSearch>> = {}) {
  const { wrapper } = createQueryWrapper()
  return render(
    <IngredientSearch
      disabled={false}
      existingIngredientIds={[]}
      onAddIngredient={vi.fn()}
      {...props}
    />,
    { wrapper },
  )
}

// jsdom has no scrollIntoView; the list scrolls itself clear of the phone tab
// bar once results show (HON-1378).
const scrollIntoView = vi.fn()

beforeEach(() => {
  scrollIntoView.mockClear()
  Element.prototype.scrollIntoView = scrollIntoView
})

afterEach(() => {
  delete (Element.prototype as Partial<Element>).scrollIntoView
})

describe('IngredientSearch ARIA attributes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('should have combobox role on input', () => {
    renderSearch()

    const input = screen.getByRole('combobox')
    expect(input).toBeInTheDocument()
  })

  it('should have aria-expanded=false when dropdown is closed', () => {
    renderSearch()

    const input = screen.getByRole('combobox')
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('should have aria-autocomplete=list on input', () => {
    renderSearch()

    const input = screen.getByRole('combobox')
    expect(input).toHaveAttribute('aria-autocomplete', 'list')
  })

  it('should not have aria-controls when dropdown is closed', () => {
    renderSearch()

    const input = screen.getByRole('combobox')
    expect(input).not.toHaveAttribute('aria-controls')
  })

  it('should show listbox with options when results appear', async () => {
    mockFetchSuccess(mockIngredients)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    renderSearch()

    const input = screen.getByRole('combobox')
    await user.type(input, 'tom')
    await vi.advanceTimersByTimeAsync(350)

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })

    const listbox = screen.getByRole('listbox')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(input).toHaveAttribute('aria-controls', listbox.id)

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
  })

  it('should set aria-selected on highlighted option via keyboard', async () => {
    mockFetchSuccess(mockIngredients)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    renderSearch()

    const input = screen.getByRole('combobox')
    await user.type(input, 'tom')
    await vi.advanceTimersByTimeAsync(350)

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })

    // The first option is highlighted as soon as results show (HON-1362)
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[1]).toHaveAttribute('aria-selected', 'false')
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id)

    // Arrow down moves to the second option
    await user.keyboard('{ArrowDown}')

    expect(options[0]).toHaveAttribute('aria-selected', 'false')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', options[1]!.id)
  })

  it('should update aria-activedescendant when navigating options', async () => {
    mockFetchSuccess(mockIngredients)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    renderSearch()

    const input = screen.getByRole('combobox')
    await user.type(input, 'tom')
    await vi.advanceTimersByTimeAsync(350)

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })

    const options = screen.getAllByRole('option')
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id)

    // Down stops at the last option; up stops at the first
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant', options[1]!.id)

    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id)
  })
})

describe('IngredientSearch after a selection', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not re-offer the previous query under a new search', async () => {
    mockFetchSuccess(mockIngredients)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onAddIngredient = vi.fn()

    renderSearch({ onAddIngredient })

    const input = screen.getByRole('combobox')
    await user.type(input, 'tom')
    await vi.advanceTimersByTimeAsync(350)
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument())

    await user.keyboard('{Enter}')
    expect(onAddIngredient).toHaveBeenCalledTimes(1)

    // Selecting clears the field; typing something unrelated inside the same
    // debounce window must not re-serve the results fetched for 'tom'.
    await user.type(input, 'b')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(input).toHaveAttribute('aria-expanded', 'false')

    await user.keyboard('{Enter}')
    expect(onAddIngredient).toHaveBeenCalledTimes(1)
  })
})

// HON-1362: most users type and press Enter, so the top result is the default.
describe('IngredientSearch Enter on the top result', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function typeAndWait(user: ReturnType<typeof userEvent.setup>, text: string) {
    const input = screen.getByRole('combobox')
    await user.type(input, text)
    await vi.advanceTimersByTimeAsync(350)
    await screen.findAllByRole('option')
    return input
  }

  it('adds the first result on Enter without the arrow keys', async () => {
    mockFetchSuccess(mockIngredients)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onAddIngredient = vi.fn()
    renderSearch({ onAddIngredient })

    const input = await typeAndWait(user, 'to')
    await user.keyboard('{Enter}')

    expect(onAddIngredient).toHaveBeenCalledExactlyOnceWith(mockIngredients[0])
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
  })

  it('adds the second result after one ArrowDown', async () => {
    mockFetchSuccess(mockIngredients)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onAddIngredient = vi.fn()
    renderSearch({ onAddIngredient })

    await typeAndWait(user, 'to')
    await user.keyboard('{ArrowDown}{Enter}')

    expect(onAddIngredient).toHaveBeenCalledExactlyOnceWith(mockIngredients[1])
  })

  it('skips a result the recipe already has', async () => {
    mockFetchSuccess(mockIngredients)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onAddIngredient = vi.fn()
    renderSearch({ onAddIngredient, existingIngredientIds: ['1'] })

    const input = await typeAndWait(user, 'to')
    const options = screen.getAllByRole('option')
    expect(input).toHaveAttribute('aria-activedescendant', options[1]!.id)

    await user.keyboard('{Enter}')
    expect(onAddIngredient).toHaveBeenCalledExactlyOnceWith(mockIngredients[1])
  })

  it('adds nothing on Enter when every result is already added', async () => {
    mockFetchSuccess(mockIngredients)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onAddIngredient = vi.fn()
    renderSearch({ onAddIngredient, existingIngredientIds: ['1', '2'] })

    const input = await typeAndWait(user, 'to')
    expect(input).not.toHaveAttribute('aria-activedescendant')

    await user.keyboard('{Enter}')
    expect(onAddIngredient).not.toHaveBeenCalled()
  })

  // Results for "to" stay on screen while the debounce catches up with "tom";
  // a quick Enter must not add from them (PR #1415 review).
  it('adds nothing on Enter while the results are for a shorter query', async () => {
    mockFetchSuccess(mockIngredients)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onAddIngredient = vi.fn()
    renderSearch({ onAddIngredient })

    const input = await typeAndWait(user, 'to')
    await user.type(input, 'm')
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(input).not.toHaveAttribute('aria-activedescendant')

    await user.keyboard('{Enter}')
    expect(onAddIngredient).not.toHaveBeenCalled()

    // Once the results for "tom" arrive, the top one is the default again.
    await vi.advanceTimersByTimeAsync(350)
    await waitFor(() => expect(input).toHaveAttribute('aria-activedescendant'))
    await user.keyboard('{Enter}')
    expect(onAddIngredient).toHaveBeenCalledExactlyOnceWith(mockIngredients[0])
  })

  it('adds nothing on Enter after Escape closed the results', async () => {
    mockFetchSuccess(mockIngredients)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onAddIngredient = vi.fn()
    renderSearch({ onAddIngredient })

    const input = await typeAndWait(user, 'to')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await user.keyboard('{Enter}')
    expect(onAddIngredient).not.toHaveBeenCalled()
    expect(input).toHaveValue('to')
  })

  it('uses the field ref a caller passes, so the caller can focus it', async () => {
    const inputRef = { current: null as HTMLInputElement | null }
    renderSearch({ inputRef })

    expect(inputRef.current).toBe(screen.getByRole('combobox'))
  })
})

// HON-1361: a click adds the row and leaves the user in the field, as Enter does.
describe('IngredientSearch after a click on a result', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('clears the field, keeps focus in it and closes the results', async () => {
    mockFetchSuccess(mockIngredients)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onAddIngredient = vi.fn()
    renderSearch({ onAddIngredient })

    const input = screen.getByRole('combobox')
    await user.type(input, 'tom')
    await vi.advanceTimersByTimeAsync(350)
    const options = await screen.findAllByRole('option')

    await user.click(options[0]!)

    expect(onAddIngredient).toHaveBeenCalledWith(mockIngredients[0])
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  // Safari and touch do not focus a button on press, and a press that lands
  // after focus left the field (here, dropped to <body>) still ends there.
  it('returns focus to the field when it had left before the press', async () => {
    mockFetchSuccess(mockIngredients)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderSearch()

    const input = screen.getByRole('combobox')
    await user.type(input, 'tom')
    await vi.advanceTimersByTimeAsync(350)
    const options = await screen.findAllByRole('option')

    dropFocusToBody()
    fireEvent.click(options[0]!)

    expect(input).toHaveFocus()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('IngredientSearch field name', () => {
  // getByLabelText matches aria-label but not a placeholder (HON-808). The
  // global next-intl mock answers from the English catalog.
  it('names the combobox independently of its placeholder', () => {
    renderSearch()

    const input = screen.getByLabelText('Search ingredients to add')
    expect(input).toHaveAttribute('role', 'combobox')
    expect(input).toHaveAttribute('placeholder', 'For example: tomato')
  })
})

// HON-1100: a row found by another English name shows that name in brackets.
describe('IngredientSearch other English name', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows the typed name in brackets and adds the row without it', async () => {
    mockFetchSuccess([
      {
        id: 'flour',
        name: 'plain flour',
        category: 'carb',
        defaultUnit: 'g',
        matchedAs: 'all-purpose flour',
      },
      { id: 'tomato', name: 'tomato', category: 'vegetable', defaultUnit: 'g' },
    ])
    const onAddIngredient = vi.fn()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderSearch({ onAddIngredient })

    await user.type(screen.getByRole('combobox'), 'all-purpose')
    await vi.advanceTimersByTimeAsync(350)

    const options = await screen.findAllByRole('option')
    expect(options[0]).toHaveTextContent('plain flour(all-purpose flour)')
    expect(options[1]).not.toHaveTextContent('(all-purpose flour)')

    await user.click(options[0]!)

    expect(onAddIngredient).toHaveBeenCalledWith({
      id: 'flour',
      name: 'plain flour',
      category: 'carb',
      defaultUnit: 'g',
    })
  })
})

// HON-1378: on a phone the list opens under the tab bar unless it scrolls up.
describe('IngredientSearch results near the screen bottom', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('scrolls the results list into view, clear of the tab bar, once results show', async () => {
    mockFetchSuccess(mockIngredients)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderSearch()

    await user.type(screen.getByRole('combobox'), 'to')
    expect(scrollIntoView).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(350)

    const listbox = await screen.findByRole('listbox')
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    expect(scrollIntoView.mock.contexts).toContain(listbox)
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'nearest' }))
    expect(listbox).toHaveClass('scroll-mb-above-tab-bar', 'md:scroll-mb-0')
  })
})
