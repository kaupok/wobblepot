import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ShoppingEmptyState } from './ShoppingEmptyState'
import { WINDOW_STORAGE_KEY } from './use-shopping-window'

const push = vi.fn()
const replace = vi.fn()

// The picker navigates; the mount reconcile lives in `InventoryPage`, so
// nothing here should call either verb on its own.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
}))

beforeEach(() => {
  push.mockClear()
  replace.mockClear()
  localStorage.clear()
})

/** The picker's accessible name (`shopping.ariaTimeWindow`). */
const windowPicker = () => screen.queryByRole('combobox', { name: 'Time window' })

describe('ShoppingEmptyState', () => {
  describe('no-plan variant', () => {
    it('renders no-plan heading and description', () => {
      render(<ShoppingEmptyState variant="no-plan" />)

      expect(screen.getByRole('heading', { name: 'No meal plan yet' })).toBeInTheDocument()
      expect(
        screen.getByText('Generate a meal plan to see your shopping list.'),
      ).toBeInTheDocument()
    })

    it('renders generate plan button linking to the dashboard', () => {
      render(<ShoppingEmptyState variant="no-plan" />)

      const link = screen.getByRole('link', { name: 'Generate plan' })
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute('href', '/')
    })

    it('does not show the header or the window picker', () => {
      render(<ShoppingEmptyState variant="no-plan" />)

      expect(screen.queryByRole('heading', { name: 'Shopping list' })).not.toBeInTheDocument()
      expect(windowPicker()).not.toBeInTheDocument()
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

    it('renders the header with the window picker', () => {
      render(<ShoppingEmptyState variant="nothing-needed" windowDays={7} />)

      expect(screen.getByRole('heading', { name: 'Shopping list' })).toBeInTheDocument()
      expect(windowPicker()).toBeInTheDocument()
    })

    // The reconcile is not this component's job — it lives in `InventoryPage`,
    // so it also reaches the header-less `no-plan` and `error` states. Rendering
    // the empty state on its own must not navigate.
    it('does not navigate on its own', () => {
      localStorage.setItem(WINDOW_STORAGE_KEY, '14')

      render(<ShoppingEmptyState variant="nothing-needed" windowDays={7} />)

      expect(replace).not.toHaveBeenCalled()
      expect(push).not.toHaveBeenCalled()
    })
  })

  describe('all-purchased variant', () => {
    it('renders all-purchased heading', () => {
      render(<ShoppingEmptyState variant="all-purchased" />)

      expect(screen.getByRole('heading', { name: 'All done!' })).toBeInTheDocument()
      expect(screen.getByText('Your pantry is stocked for the week.')).toBeInTheDocument()
    })

    // The state `ShoppingSection` hands off to once the last item is checked
    // off. Before HON-624 it had no picker either, so a 14-day list that was
    // fully purchased was another dead end.
    it('renders the header with the window picker', () => {
      render(<ShoppingEmptyState variant="all-purchased" windowDays={14} />)

      expect(screen.getByRole('heading', { name: 'Shopping list' })).toBeInTheDocument()
      expect(windowPicker()).toBeInTheDocument()
    })
  })

  describe('error variant', () => {
    it('renders error heading with dashboard link', () => {
      render(<ShoppingEmptyState variant="error" />)

      expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
      const link = screen.getByRole('link', { name: 'Go to dashboard' })
      expect(link).toHaveAttribute('href', '/')
    })

    it('does not show the header or the window picker', () => {
      render(<ShoppingEmptyState variant="error" />)

      expect(screen.queryByRole('heading', { name: 'Shopping list' })).not.toBeInTheDocument()
      expect(windowPicker()).not.toBeInTheDocument()
    })
  })
})
