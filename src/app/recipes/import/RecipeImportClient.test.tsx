import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// The failure copy has to be resolved against a real catalog in a real locale;
// the global mock always answers from English, which would make the Estonian
// assertions below pass whether or not the leak is fixed (HON-700).
vi.unmock('next-intl')
import { render, screen, fireEvent, act } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import enMessages from '../../../../messages/en.json'
import etMessages from '../../../../messages/et.json'
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
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {node}
    </NextIntlClientProvider>,
  )
}

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
    renderInLocale(<RecipeImportClient />, 'en')

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
    renderInLocale(<RecipeImportClient />, 'en')

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

    renderInLocale(<RecipeImportClient />, 'en')

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
    expect(screen.getByText(enMessages.recipes.import.errors.parseFailed)).toBeInTheDocument()
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
    renderInLocale(<RecipeImportClient />, 'en')

    // Cancel button not visible initially
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()
    // "create manually" link visible
    expect(screen.getByText(/create manually/i)).toBeInTheDocument()

    // Start import
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'https://example.com/recipe' } })
    fireEvent.click(screen.getByRole('button', { name: /import recipe/i }))

    // Cancel button visible during parsing
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    // "create manually" link hidden
    expect(screen.queryByText(/create manually/i)).not.toBeInTheDocument()
  })

  it('aborts request and restores textarea on cancel', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort')

    renderInLocale(<RecipeImportClient />, 'en')

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

    // Cancel button hidden, "create manually" link back
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()
    expect(screen.getByText(/create manually/i)).toBeInTheDocument()

    abortSpy.mockRestore()
  })

  it('does not show error when request is aborted', async () => {
    // Mock fetch to reject with AbortError
    const abortError = new Error('The operation was aborted.')
    abortError.name = 'AbortError'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))

    renderInLocale(<RecipeImportClient />, 'en')

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
    renderInLocale(<RecipeImportClient />, locale)
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

  it('falls back to the generic translated message for an unrecognised code', async () => {
    respondWith(
      { success: false, error: 'Some brand new failure', code: 'code_from_a_newer_deploy' },
      500,
    )

    parse('et')

    await screen.findByText(etMessages.recipes.import.errors.parseFailed)
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
})
