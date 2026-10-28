import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// The failure copy has to be resolved against a real catalog in a real locale;
// the global mock always answers from English, which would make the Estonian
// assertions below pass whether or not the leak is fixed (HON-700).
vi.unmock('next-intl')
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import enMessages from '../../../../messages/en.json'
import etMessages from '../../../../messages/et.json'
import { createQueryWrapper } from '@/test/query-wrapper'
import { RecipeImportClient } from './RecipeImportClient'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}))

function renderInLocale(node: ReactNode, locale: 'en' | 'et') {
  const messages = locale === 'en' ? enMessages : etMessages
  const { wrapper: QueryWrapper } = createQueryWrapper()
  return render(
    <QueryWrapper>
      <NextIntlClientProvider locale={locale} messages={messages}>
        {node}
      </NextIntlClientProvider>
    </QueryWrapper>,
  )
}

describe('RecipeImportClient heading', () => {
  // The library's "Add recipe" button opens this page, so the heading matches
  // its label (HON-1062, HON-1271). The submit keeps "Import recipe".
  it.each([
    ['en', 'Add recipe', 'Import recipe', 'Start from a blank recipe'],
    ['et', 'Lisa retsept', 'Impordi retsept', 'Alusta tühjast retseptist'],
  ] as const)(
    'reads %s: heading %s, submit %s, blank link %s',
    (locale, heading, submit, blank) => {
      renderInLocale(<RecipeImportClient defaultServings={4} />, locale)
      expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: submit })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: blank })).toHaveAttribute('href', '/recipes/create')
    },
  )
})

describe('RecipeImportClient column', () => {
  // A narrow form column, centred in the page so a wide screen is balanced
  // (HON-1368). The route skeleton mirrors it.
  it('puts the title in a centred max-w-2xl column', () => {
    renderInLocale(<RecipeImportClient defaultServings={4} />, 'en')
    const column = screen
      .getByRole('heading', { level: 1, name: 'Add recipe' })
      .closest('.max-w-2xl')
    expect(column).toHaveClass('mx-auto')
  })
})

describe('RecipeImportClient progress steps', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Mock fetch to hang (simulating slow import)
    vi.stubGlobal('fetch', () => new Promise(() => {}))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows URL progress steps when importing a URL', () => {
    renderInLocale(<RecipeImportClient defaultServings={4} />, 'en')

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'https://example.com/recipe' } })

    const button = screen.getByRole('button', { name: /import recipe/i })
    fireEvent.click(button)

    // First step shows immediately
    expect(screen.getByText('Fetching page…')).toBeInTheDocument()

    // After 4s, transitions to second step
    act(() => vi.advanceTimersByTime(4000 + 150))
    expect(screen.getByText('Extracting recipe…')).toBeInTheDocument()

    // After 10s total, transitions to third step
    act(() => vi.advanceTimersByTime(6000 + 150))
    expect(screen.getByText('Matching ingredients…')).toBeInTheDocument()
  })

  it('shows text progress steps when importing plain text', () => {
    renderInLocale(<RecipeImportClient defaultServings={4} />, 'en')

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, {
      target: { value: 'Chicken Stir Fry\n- 500g chicken' },
    })

    const button = screen.getByRole('button', { name: /import recipe/i })
    fireEvent.click(button)

    // First step shows immediately (no "Fetching page..." for text)
    expect(screen.getByText('Extracting recipe…')).toBeInTheDocument()
    expect(screen.queryByText('Fetching page…')).not.toBeInTheDocument()

    // After 4s, transitions to second step
    act(() => vi.advanceTimersByTime(4000 + 150))
    expect(screen.getByText('Matching ingredients…')).toBeInTheDocument()
  })

  it('clears progress steps on error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Failed to parse' }),
      }),
    )

    renderInLocale(<RecipeImportClient defaultServings={4} />, 'en')

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'https://example.com/recipe' } })

    const button = screen.getByRole('button', { name: /import recipe/i })
    fireEvent.click(button)

    // Step is visible during parsing
    expect(screen.getByText('Fetching page…')).toBeInTheDocument()

    // Let the fetch resolve (error) and timers run
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    // Error shown, progress step cleared. The rendered string is the client's
    // own translated copy — never the server's `error` prose (HON-700).
    expect(screen.getByText(enMessages.recipes.import.errors.parseGeneric)).toBeInTheDocument()
    expect(screen.queryByText('Failed to parse')).not.toBeInTheDocument()
    expect(screen.queryByText('Fetching page…')).not.toBeInTheDocument()
    expect(screen.queryByText('Extracting recipe…')).not.toBeInTheDocument()
    expect(screen.queryByText('Matching ingredients…')).not.toBeInTheDocument()
  })
})

describe('RecipeImportClient cancel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Mock fetch to hang (simulating slow import)
    vi.stubGlobal('fetch', () => new Promise(() => {}))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows cancel button during parsing and hides it otherwise', () => {
    renderInLocale(<RecipeImportClient defaultServings={4} />, 'en')

    // Cancel button not visible initially
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()
    // The outline "Start from a blank recipe" link to the blank form is visible
    const blank = screen.getByRole('link', { name: 'Start from a blank recipe' })
    expect(blank).toHaveAttribute('href', '/recipes/create')
    expect(blank.dataset.variant).toBe('outline')

    // Start import
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'https://example.com/recipe' } })
    fireEvent.click(screen.getByRole('button', { name: /import recipe/i }))

    // Cancel button visible during parsing
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    // Cancel takes the blank-recipe link's place
    expect(
      screen.queryByRole('link', { name: 'Start from a blank recipe' }),
    ).not.toBeInTheDocument()
  })

  it('aborts request and restores textarea on cancel', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort')

    renderInLocale(<RecipeImportClient defaultServings={4} />, 'en')

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'https://example.com/recipe' } })
    fireEvent.click(screen.getByRole('button', { name: /import recipe/i }))

    // Click cancel
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    // Let state updates settle
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    // AbortController.abort was called
    expect(abortSpy).toHaveBeenCalled()

    // Textarea is editable again with original content preserved
    expect(textarea).not.toBeDisabled()
    expect(textarea).toHaveValue('https://example.com/recipe')

    // No error message shown
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument()

    // Cancel button hidden, the blank-recipe link back
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start from a blank recipe' })).toBeInTheDocument()

    abortSpy.mockRestore()
  })

  it('does not show error when request is aborted', async () => {
    // Mock fetch to reject with AbortError
    const abortError = new Error('The operation was aborted.')
    abortError.name = 'AbortError'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))

    renderInLocale(<RecipeImportClient defaultServings={4} />, 'en')

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'https://example.com/recipe' } })
    fireEvent.click(screen.getByRole('button', { name: /import recipe/i }))

    // Let the fetch rejection resolve
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    // No error shown for abort
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument()
  })
})

describe('RecipeImportClient error localization', () => {
  /** The English prose `/api/recipes/parse` puts in `data.error` on a 504. */
  const SERVER_PROSE = 'Reading that recipe took too long. Please try again.'

  beforeEach(() => {
    // The breadcrumb the client writes instead of rendering the server prose.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function respondWith(body: Record<string, unknown>, status: number) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: status < 400,
        status,
        json: () => Promise.resolve(body),
      }),
    )
  }

  function parse(locale: 'en' | 'et') {
    renderInLocale(<RecipeImportClient defaultServings={4} />, locale)
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'https://example.com/recipe' },
    })
    const label = locale === 'en' ? /import recipe/i : /impordi retsept/i
    fireEvent.click(screen.getByRole('button', { name: label }))
  }

  it('renders the Estonian timeout copy for a 504, not the server prose', async () => {
    respondWith({ success: false, error: SERVER_PROSE, code: 'parse_timeout' }, 504)

    parse('et')

    await screen.findByText(etMessages.recipes.import.errors.parseTimeout)
    expect(screen.queryByText(SERVER_PROSE)).not.toBeInTheDocument()
  })

  it('renders the Estonian copy for a robots-disallowed 403', async () => {
    respondWith(
      {
        success: false,
        error: 'That site does not allow importing.',
        code: 'robots_disallowed',
      },
      403,
    )

    parse('et')

    await screen.findByText(etMessages.recipes.import.errors.robotsDisallowed)
  })

  it('renders the English timeout copy on the en locale', async () => {
    respondWith({ success: false, error: SERVER_PROSE, code: 'parse_timeout' }, 504)

    parse('en')

    await screen.findByText(enMessages.recipes.import.errors.parseTimeout)
  })

  it('names the time the hourly limit lifts when the 429 carries resetAt', async () => {
    respondWith(
      {
        success: false,
        error: 'Rate limit exceeded',
        code: 'rate_limited',
        // 18:40 on the device clock, whatever TZ the test runs in.
        resetAt: new Date(2026, 9, 9, 18, 40).toISOString(),
      },
      429,
    )

    parse('en')

    await screen.findByText(
      enMessages.recipes.import.errors.rateLimitedUntil.replace('{time}', '6:40 PM'),
    )
  })

  it('keeps the plain rate-limit copy when the 429 has no resetAt', async () => {
    respondWith({ success: false, error: 'Rate limit exceeded', code: 'rate_limited' }, 429)

    parse('et')

    await screen.findByText(etMessages.recipes.import.errors.rateLimited)
  })

  it('falls back to the generic translated message for an unrecognised code', async () => {
    respondWith(
      { success: false, error: 'Some brand new failure', code: 'code_from_a_newer_deploy' },
      500,
    )

    parse('et')

    await screen.findByText(etMessages.recipes.import.errors.parseGeneric)
    expect(screen.queryByText('Some brand new failure')).not.toBeInTheDocument()
  })

  it('keeps the server prose reachable as a console breadcrumb', async () => {
    respondWith({ success: false, error: SERVER_PROSE, code: 'parse_timeout' }, 504)

    parse('et')

    await screen.findByText(etMessages.recipes.import.errors.parseTimeout)
    expect(console.error).toHaveBeenCalledWith(
      '[recipe-import] request failed',
      expect.objectContaining({ code: 'parse_timeout', error: SERVER_PROSE }),
    )
  })

  it('renders the translated medium-confidence warning, not the server sentence', async () => {
    // The success path had the same dead `||` as the error path:
    // `evaluateRecipeConfidence` always sets a message on the medium tier, so
    // the translation was never reached.
    const SERVER_WARNING =
      "We're not confident this is a complete recipe. The results may be incomplete or inaccurate."
    respondWith(
      {
        success: true,
        confidenceTier: 'medium',
        confidenceWarning: SERVER_WARNING,
        recipe: { name: 'Kanapraad', ingredients: [] },
      },
      200,
    )

    parse('et')

    await screen.findByText(etMessages.recipes.import.warningDefault)
    expect(screen.queryByText(SERVER_WARNING)).not.toBeInTheDocument()
  })
})

describe("RecipeImportClient household's size (HON-1363)", () => {
  // A recipe with no servings gets the household's size, the same start the
  // blank form uses, so the page names the number the parser falls back to.
  it.each([
    ['en', "Include how many servings it makes, otherwise we'll use your household's size (3)."],
    [
      'et',
      'Kirjuta juurde, mitmele inimesele see on, muidu arvestame sinu leibkonna suurusega (3).',
    ],
  ] as const)('names the fallback servings in %s', (locale, expected) => {
    renderInLocale(<RecipeImportClient defaultServings={3} />, locale)

    expect(screen.getByText(expected, { exact: false })).toBeInTheDocument()
  })
})

describe('RecipeImportClient paste field name', () => {
  // The placeholder is example text; without a label that is what a screen
  // reader announces as the field's name (HON-808).
  it.each(['en', 'et'] as const)('names the paste textarea in %s', (locale) => {
    const messages = locale === 'en' ? enMessages : etMessages
    renderInLocale(<RecipeImportClient defaultServings={4} />, locale)

    expect(screen.getByLabelText(messages.recipes.import.textAria)).toHaveAttribute(
      'placeholder',
      messages.recipes.import.placeholder,
    )
  })
})

// The create page decides which event a save fires from the stash's `origin`,
// not from `originalRecipeText` (HON-1063).
describe('RecipeImportClient stash origin', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("marks the prefilled-meal stash with origin 'import'", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            success: true,
            confidenceTier: 'high',
            recipe: {
              name: 'Lentil stew',
              description: null,
              preparationNotes: null,
              sourceUrl: null,
              timeMinutes: 25,
              servings: 4,
              mealTypes: ['dinner'],
              kidFriendly: true,
              ingredients: [],
              allMatched: true,
            },
          }),
      }),
    )
    renderInLocale(<RecipeImportClient defaultServings={4} />, 'en')
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Lentil stew\n- 200g lentils' },
    })
    fireEvent.click(screen.getByRole('button', { name: /import recipe/i }))

    await waitFor(() => expect(sessionStorage.getItem('prefilled-meal')).not.toBeNull())
    expect(JSON.parse(sessionStorage.getItem('prefilled-meal')!)).toMatchObject({
      name: 'Lentil stew',
      origin: 'import',
      originalRecipeText: 'Lentil stew\n- 200g lentils',
    })
  })
})
