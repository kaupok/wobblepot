import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RecipeImportClient } from './RecipeImportClient'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}))

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
    render(<RecipeImportClient />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'https://example.com/recipe' } })

    const button = screen.getByRole('button', { name: /import recipe/i })
    fireEvent.click(button)

    // First step shows immediately
    expect(screen.getByText('Fetching page...')).toBeInTheDocument()

    // After 4s, transitions to second step
    act(() => vi.advanceTimersByTime(4000 + 150))
    expect(screen.getByText('Extracting recipe...')).toBeInTheDocument()

    // After 10s total, transitions to third step
    act(() => vi.advanceTimersByTime(6000 + 150))
    expect(screen.getByText('Matching ingredients...')).toBeInTheDocument()
  })

  it('shows text progress steps when importing plain text', () => {
    render(<RecipeImportClient />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, {
      target: { value: 'Chicken Stir Fry\n- 500g chicken' },
    })

    const button = screen.getByRole('button', { name: /import recipe/i })
    fireEvent.click(button)

    // First step shows immediately (no "Fetching page..." for text)
    expect(screen.getByText('Extracting recipe...')).toBeInTheDocument()
    expect(screen.queryByText('Fetching page...')).not.toBeInTheDocument()

    // After 4s, transitions to second step
    act(() => vi.advanceTimersByTime(4000 + 150))
    expect(screen.getByText('Matching ingredients...')).toBeInTheDocument()
  })

  it('clears progress steps on error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Failed to parse' }),
      }),
    )

    render(<RecipeImportClient />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'https://example.com/recipe' } })

    const button = screen.getByRole('button', { name: /import recipe/i })
    fireEvent.click(button)

    // Step is visible during parsing
    expect(screen.getByText('Fetching page...')).toBeInTheDocument()

    // Let the fetch resolve (error) and timers run
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    // Error shown, progress step cleared
    expect(screen.getByText('Failed to parse')).toBeInTheDocument()
    expect(screen.queryByText('Fetching page...')).not.toBeInTheDocument()
    expect(screen.queryByText('Extracting recipe...')).not.toBeInTheDocument()
    expect(screen.queryByText('Matching ingredients...')).not.toBeInTheDocument()
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
    render(<RecipeImportClient />)

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

    render(<RecipeImportClient />)

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

    render(<RecipeImportClient />)

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
