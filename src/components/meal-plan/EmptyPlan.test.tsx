import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EmptyPlan } from './EmptyPlan'

// Mock next/navigation
const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}))

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock GeneratingOverlay to simplify tests
vi.mock('./GeneratingOverlay', () => ({
  GeneratingOverlay: () => <div data-testid="generating-overlay">Generating...</div>,
}))

describe('EmptyPlan', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockRefresh.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders heading and description', () => {
      render(<EmptyPlan />)

      expect(
        screen.getByRole('heading', { name: 'No meal plan for this week' }),
      ).toBeInTheDocument()
      expect(screen.getByText('Generate your first meal plan to get started.')).toBeInTheDocument()
    })

    it('renders generate button', () => {
      render(<EmptyPlan />)

      expect(screen.getByRole('button', { name: 'Generate meal plan' })).toBeInTheDocument()
    })

    it('button is enabled by default', () => {
      render(<EmptyPlan />)

      expect(screen.getByRole('button', { name: 'Generate meal plan' })).not.toBeDisabled()
    })
  })

  describe('generation flow', () => {
    it('shows overlay when generating', async () => {
      mockFetch.mockImplementation(() => new Promise(() => {})) // Never resolves

      render(<EmptyPlan />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate meal plan' }))

      expect(screen.getByTestId('generating-overlay')).toBeInTheDocument()
    })

    it('disables button during generation', async () => {
      mockFetch.mockImplementation(() => new Promise(() => {}))

      render(<EmptyPlan />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate meal plan' }))

      expect(screen.getByRole('button', { name: 'Generating...' })).toBeDisabled()
    })

    it('calls generate endpoint on button click', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

      render(<EmptyPlan />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate meal plan' }))

      expect(mockFetch).toHaveBeenCalledWith('/api/meal-plans/generate', {
        method: 'POST',
        signal: expect.any(AbortSignal),
      })
    })

    it('calls router.refresh on success', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

      render(<EmptyPlan />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate meal plan' }))

      await waitFor(() => {
        expect(mockRefresh).toHaveBeenCalled()
      })
    })

    it('hides overlay on success', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

      render(<EmptyPlan />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate meal plan' }))

      await waitFor(() => {
        expect(screen.queryByTestId('generating-overlay')).not.toBeInTheDocument()
      })
    })
  })

  describe('error handling', () => {
    it('shows error message on 429 rate limit', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({}),
      })

      render(<EmptyPlan />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate meal plan' }))

      await waitFor(() => {
        expect(screen.getByText('Rate limit exceeded. Please try again later.')).toBeInTheDocument()
      })
    })

    it('shows error message on 409 conflict', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 409,
        json: () => Promise.resolve({}),
      })

      render(<EmptyPlan />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate meal plan' }))

      await waitFor(() => {
        expect(screen.getByText('A meal plan already exists for this week.')).toBeInTheDocument()
      })
    })

    it('shows error message on 422 with server message', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ message: 'Not enough meal options' }),
      })

      render(<EmptyPlan />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate meal plan' }))

      await waitFor(() => {
        expect(screen.getByText('Not enough meal options')).toBeInTheDocument()
      })
    })

    it('shows generic error on 500', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      })

      render(<EmptyPlan />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate meal plan' }))

      await waitFor(() => {
        expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument()
      })
    })

    it('hides overlay on error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      })

      render(<EmptyPlan />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate meal plan' }))

      await waitFor(() => {
        expect(screen.queryByTestId('generating-overlay')).not.toBeInTheDocument()
      })
    })

    it('re-enables button after error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      })

      render(<EmptyPlan />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate meal plan' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Generate meal plan' })).not.toBeDisabled()
      })
    })

    it('allows retry after error', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })

      render(<EmptyPlan />)

      // First attempt fails
      await userEvent.click(screen.getByRole('button', { name: 'Generate meal plan' }))
      await waitFor(() => {
        expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument()
      })

      // Retry succeeds
      await userEvent.click(screen.getByRole('button', { name: 'Generate meal plan' }))
      await waitFor(() => {
        expect(mockRefresh).toHaveBeenCalled()
      })
    })

    it('clears previous error on retry', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      })

      render(<EmptyPlan />)

      // First attempt
      await userEvent.click(screen.getByRole('button', { name: 'Generate meal plan' }))
      await waitFor(() => {
        expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument()
      })

      // Setup for second attempt (never resolves)
      mockFetch.mockImplementation(() => new Promise(() => {}))

      // Start retry - error should clear when loading starts
      await userEvent.click(screen.getByRole('button', { name: 'Generate meal plan' }))

      await waitFor(() => {
        expect(
          screen.queryByText('Something went wrong. Please try again.'),
        ).not.toBeInTheDocument()
      })
    })
  })
})
