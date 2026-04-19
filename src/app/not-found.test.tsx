import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import NotFound from './not-found'

describe('NotFound', () => {
  it('renders the heading and description', () => {
    render(<NotFound />)

    expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument()
    expect(
      screen.getByText(/the page you're looking for doesn't exist or has been moved/i),
    ).toBeInTheDocument()
  })

  it('renders a link to the home page', () => {
    render(<NotFound />)

    const link = screen.getByRole('link', { name: /go home/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/')
  })
})
