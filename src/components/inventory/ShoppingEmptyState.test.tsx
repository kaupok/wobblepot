import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ShoppingEmptyState } from './ShoppingEmptyState'

describe('ShoppingEmptyState', () => {
  it('renders the error heading with a dashboard link', () => {
    render(<ShoppingEmptyState />)

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(
      screen.getByText("We couldn't load your shopping list. Please try again."),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute('href', '/')
  })

  // The load-failed state is the one state with no list (HON-1354).
  it('does not show the header, the window picker or the Add field', () => {
    render(<ShoppingEmptyState />)

    expect(screen.queryByRole('heading', { name: 'Shopping list' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Time window' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
