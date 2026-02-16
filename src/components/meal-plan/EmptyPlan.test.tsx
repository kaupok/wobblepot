import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EmptyPlan } from './EmptyPlan'
import type { WeekContext } from './types'

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

// Default week context for most tests
const defaultWeekContext: WeekContext = {
  type: 'current',
  daysCount: 7,
  isPartialWeek: false,
}

describe('EmptyPlan', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockRefresh.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders heading and description for current week', () => {
      render(<EmptyPlan weekContext={defaultWeekContext} />)

      expect(
        screen.getByRole('heading', { name: 'No meal plan for this week' }),
      ).toBeInTheDocument()
      expect(
        screen.getByText('Generate your meal plan for this week to get started.'),
      ).toBeInTheDocument()
    })

    it('renders heading and description for next week', () => {
      render(<EmptyPlan weekContext={{ type: 'next', daysCount: 7, isPartialWeek: false }} />)

      expect(
        screen.getByRole('heading', { name: 'No meal plan for next week' }),
      ).toBeInTheDocument()
      expect(screen.getByText('Generate your meal plan for next week.')).toBeInTheDocument()
    })

    it('renders partial week description', () => {
      render(<EmptyPlan weekContext={{ type: 'current', daysCount: 4, isPartialWeek: true }} />)

      expect(
        screen.getByText('Generate a plan for the remaining 4 days of this week.'),
      ).toBeInTheDocument()
    })

    it('renders generate button for current week', () => {
      render(<EmptyPlan weekContext={defaultWeekContext} />)

      expect(screen.getByRole('button', { name: 'Generate this week' })).toBeInTheDocument()
    })

    it('renders generate button for next week', () => {
      render(<EmptyPlan weekContext={{ type: 'next', daysCount: 7, isPartialWeek: false }} />)

      expect(screen.getByRole('button', { name: 'Generate next week' })).toBeInTheDocument()
    })

    it('button is enabled by default', () => {
      render(<EmptyPlan weekContext={defaultWeekContext} />)

      expect(screen.getByRole('button', { name: 'Generate this week' })).not.toBeDisabled()
    })

    it('renders create empty week link', () => {
      render(<EmptyPlan weekContext={defaultWeekContext} />)

      expect(screen.getByText('or create empty week')).toBeInTheDocument()
    })
  })

  describe('generation flow', () => {
    it('shows overlay when generating', async () => {
      mockFetch.mockImplementation(() => new Promise(() => {})) // Never resolves

      render(<EmptyPlan weekContext={defaultWeekContext} />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate this week' }))

      expect(screen.getByTestId('generating-overlay')).toBeInTheDocument()
    })

    it('disables button during generation', async () => {
      mockFetch.mockImplementation(() => new Promise(() => {}))

      render(<EmptyPlan weekContext={defaultWeekContext} />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate this week' }))

      expect(screen.getByRole('button', { name: 'Generating...' })).toBeDisabled()
    })

    it('calls generate endpoint with targetWeek on button click', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

      render(<EmptyPlan weekContext={defaultWeekContext} />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate this week' }))

      expect(mockFetch).toHaveBeenCalledWith('/api/meal-plans/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetWeek: 'current', mode: 'generate' }),
        signal: expect.any(AbortSignal),
      })
    })

    it('calls generate endpoint with next week target', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

      render(<EmptyPlan weekContext={{ type: 'next', daysCount: 7, isPartialWeek: false }} />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate next week' }))

      expect(mockFetch).toHaveBeenCalledWith('/api/meal-plans/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetWeek: 'next', mode: 'generate' }),
        signal: expect.any(AbortSignal),
      })
    })

    it('calls generate endpoint with empty mode when creating empty week', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

      render(<EmptyPlan weekContext={defaultWeekContext} />)

      await userEvent.click(screen.getByText('or create empty week'))

      expect(mockFetch).toHaveBeenCalledWith('/api/meal-plans/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetWeek: 'current', mode: 'empty' }),
        signal: expect.any(AbortSignal),
      })
    })

    it('calls router.refresh on success', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

      render(<EmptyPlan weekContext={defaultWeekContext} />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate this week' }))

      await waitFor(() => {
        expect(mockRefresh).toHaveBeenCalled()
      })
    })

    it('hides overlay on success', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

      render(<EmptyPlan weekContext={defaultWeekContext} />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate this week' }))

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

      render(<EmptyPlan weekContext={defaultWeekContext} />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate this week' }))

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

      render(<EmptyPlan weekContext={defaultWeekContext} />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate this week' }))

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

      render(<EmptyPlan weekContext={defaultWeekContext} />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate this week' }))

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

      render(<EmptyPlan weekContext={defaultWeekContext} />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate this week' }))

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

      render(<EmptyPlan weekContext={defaultWeekContext} />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate this week' }))

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

      render(<EmptyPlan weekContext={defaultWeekContext} />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate this week' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Generate this week' })).not.toBeDisabled()
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

      render(<EmptyPlan weekContext={defaultWeekContext} />)

      // First attempt fails
      await userEvent.click(screen.getByRole('button', { name: 'Generate this week' }))
      await waitFor(() => {
        expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument()
      })

      // Retry succeeds
      await userEvent.click(screen.getByRole('button', { name: 'Generate this week' }))
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

      render(<EmptyPlan weekContext={defaultWeekContext} />)

      // First attempt
      await userEvent.click(screen.getByRole('button', { name: 'Generate this week' }))
      await waitFor(() => {
        expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument()
      })

      // Setup for second attempt (never resolves)
      mockFetch.mockImplementation(() => new Promise(() => {}))

      // Start retry - error should clear when loading starts
      await userEvent.click(screen.getByRole('button', { name: 'Generate this week' }))

      await waitFor(() => {
        expect(
          screen.queryByText('Something went wrong. Please try again.'),
        ).not.toBeInTheDocument()
      })
    })
  })

  describe('first-time generation', () => {
    it('does not show restrictions textarea', () => {
      render(<EmptyPlan weekContext={defaultWeekContext} isFirstGeneration />)

      expect(screen.queryByLabelText('Anything else?')).not.toBeInTheDocument()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('does not send restrictions in preferences payload', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

      render(<EmptyPlan weekContext={defaultWeekContext} isFirstGeneration />)

      await userEvent.click(screen.getByRole('button', { name: 'Generate meal plan' }))

      await waitFor(() => {
        // First call is preferences PATCH
        const prefsCall = mockFetch.mock.calls[0]!
        expect(prefsCall[0]).toBe('/api/households/me/preferences')
        const body = JSON.parse(prefsCall[1]!.body)
        expect(body).not.toHaveProperty('restrictions')
      })
    })
  })
})
