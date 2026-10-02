import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import LegalLayout from './layout'

describe('LegalLayout', () => {
  it('marks the legal prose as English so assistive tech switches language (HON-918)', () => {
    // A bare text child, so getByText returns the layout's own container.
    render(<LegalLayout>Policy text</LegalLayout>)
    expect(screen.getByText('Policy text')).toHaveAttribute('lang', 'en')
  })
})
