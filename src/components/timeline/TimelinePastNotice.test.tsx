import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TimelinePastNotice } from './TimelinePastNotice'

describe('TimelinePastNotice', () => {
  it('renders nothing when no past meal needs marking', () => {
    const { container } = render(<TimelinePastNotice count={0} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('states the count in a warning callout and links to /past-meals', () => {
    const { container } = render(<TimelinePastNotice count={3} />)

    const callout = container.querySelector('[data-slot="callout"]')
    expect(callout).toHaveAttribute('data-tone', 'warning')
    expect(callout).toHaveTextContent('3 past meals are not marked yet.')
    expect(screen.getByRole('link', { name: 'Mark past meals' })).toHaveAttribute(
      'href',
      '/past-meals',
    )
  })

  it('uses the singular for one meal', () => {
    render(<TimelinePastNotice count={1} />)

    expect(screen.getByText(/1 past meal is not marked yet\./)).toBeInTheDocument()
  })
})
