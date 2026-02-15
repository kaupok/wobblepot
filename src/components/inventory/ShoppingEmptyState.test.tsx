import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ShoppingEmptyState } from './ShoppingEmptyState'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

describe('ShoppingEmptyState', () => {
  describe('no-plan variant', () => {
    it('renders no-plan heading and description', () => {
      render(<ShoppingEmptyState variant="no-plan" />)

      expect(screen.getByRole('heading', { name: 'No meal plan yet' })).toBeInTheDocument()
      expect(
        screen.getByText('Generate a meal plan to see your shopping list.'),
      ).toBeInTheDocument()
    })

    it('renders generate plan button linking to /meal-plan', () => {
      render(<ShoppingEmptyState variant="no-plan" />)

      const link = screen.getByRole('link', { name: 'Generate plan' })
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute('href', '/meal-plan')
    })

    it('does not show window picker', () => {
      render(<ShoppingEmptyState variant="no-plan" />)

      expect(screen.queryByLabelText('Time window')).not.toBeInTheDocument()
    })
  })

  describe('nothing-needed variant', () => {
    it('renders nothing-needed heading with default window', () => {
      render(<ShoppingEmptyState variant="nothing-needed" windowDays={7} />)

      expect(screen.getByRole('heading', { name: 'Nothing to buy' })).toBeInTheDocument()
      expect(
        screen.getByText('Your pantry has everything you need for the next 7 days.'),
      ).toBeInTheDocument()
    })

    it('does not render a CTA button', () => {
      render(<ShoppingEmptyState variant="nothing-needed" windowDays={7} />)

      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })
  })

  describe('all-purchased variant', () => {
    it('renders all-purchased heading', () => {
      render(<ShoppingEmptyState variant="all-purchased" />)

      expect(screen.getByRole('heading', { name: 'All done!' })).toBeInTheDocument()
      expect(screen.getByText('Your pantry is stocked for the week.')).toBeInTheDocument()
    })
  })

  describe('error variant', () => {
    it('renders error heading with dashboard link', () => {
      render(<ShoppingEmptyState variant="error" />)

      expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
      const link = screen.getByRole('link', { name: 'Go to dashboard' })
      expect(link).toHaveAttribute('href', '/meal-plan')
    })
  })
})
