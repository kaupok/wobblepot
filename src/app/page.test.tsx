import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import Home from './page' // import the component directly

describe('Home page component', () => {
  it('renders the heading', () => {
    render(<Home />)
    expect(screen.getByRole('heading', { name: 'Honkadori' })).toBeInTheDocument()
  })
})
