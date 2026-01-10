import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CreateHouseholdForm } from './CreateHouseholdForm'

// Mock next/navigation
const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}))

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('CreateHouseholdForm', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockPush.mockReset()
    mockRefresh.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders form with heading and description', () => {
      render(<CreateHouseholdForm userName="John" />)

      expect(screen.getByText('Create your household')).toBeInTheDocument()
      expect(screen.getByText('Set up your household to start planning meals')).toBeInTheDocument()
    })

    it('renders name input with default value based on userName', () => {
      render(<CreateHouseholdForm userName="John" />)

      const nameInput = screen.getByLabelText('Household name')
      expect(nameInput).toHaveValue("John's Household")
    })

    it('renders submit button', () => {
      render(<CreateHouseholdForm userName="John" />)

      expect(screen.getByRole('button', { name: 'Create household' })).toBeInTheDocument()
    })
  })

  describe('form interactions', () => {
    it('allows editing the household name', async () => {
      render(<CreateHouseholdForm userName="John" />)

      const nameInput = screen.getByLabelText('Household name')
      await userEvent.clear(nameInput)
      await userEvent.type(nameInput, 'The Smith Family')

      expect(nameInput).toHaveValue('The Smith Family')
    })
  })

  describe('form submission', () => {
    it('submits form with the entered name', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'household-123',
            name: 'My Household',
          }),
      })

      render(<CreateHouseholdForm userName="John" />)

      const nameInput = screen.getByLabelText('Household name')
      await userEvent.clear(nameInput)
      await userEvent.type(nameInput, 'My Household')

      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/households', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'My Household' }),
        })
      })
    })

    it('redirects to home on successful creation', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'household-123',
            name: "John's Household",
          }),
      })

      render(<CreateHouseholdForm userName="John" />)

      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/')
        expect(mockRefresh).toHaveBeenCalled()
      })
    })

    it('shows loading state during submission', async () => {
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: () => Promise.resolve({ id: 'household-123' }),
                }),
              100,
            ),
          ),
      )

      render(<CreateHouseholdForm userName="John" />)

      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))

      expect(screen.getByRole('button', { name: 'Creating...' })).toBeDisabled()
    })

    it('disables input during submission', async () => {
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: () => Promise.resolve({ id: 'household-123' }),
                }),
              100,
            ),
          ),
      )

      render(<CreateHouseholdForm userName="John" />)

      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))

      expect(screen.getByLabelText('Household name')).toBeDisabled()
    })

    it('shows error message on API failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () =>
          Promise.resolve({
            error: 'Validation failed',
            message: 'Name is required',
          }),
      })

      render(<CreateHouseholdForm userName="John" />)

      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Name is required')
      })
    })

    it('shows generic error message when no message provided', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () =>
          Promise.resolve({
            error: 'Validation failed',
          }),
      })

      render(<CreateHouseholdForm userName="John" />)

      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Validation failed')
      })
    })

    it('redirects to home if user already has household', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () =>
          Promise.resolve({
            error: 'already_in_household',
            message: 'You are already a member of a household.',
          }),
      })

      render(<CreateHouseholdForm userName="John" />)

      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/')
        expect(mockRefresh).toHaveBeenCalled()
      })
    })

    it('handles network failure gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      render(<CreateHouseholdForm userName="John" />)

      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Unable to connect. Please check your internet connection.',
        )
      })
    })
  })
})
