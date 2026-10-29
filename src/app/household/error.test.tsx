import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import HouseholdError from './error'

vi.mock('@/lib/errors-client', () => ({
  captureClientError: vi.fn(),
}))

describe('HouseholdError', () => {
  // The boundary renders under the layout's "Household" h1 and the tabs
  // (HON-1257), so it is a Section-level h2 and not a second page.
  it('renders a section h2 under the layout, not a page of its own', () => {
    render(
      <HouseholdError
        error={Object.assign(new Error('boom'), { digest: 'abc' })}
        reset={vi.fn()}
      />,
    )

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    const heading = screen.getByRole('heading', { level: 2, name: "Couldn't load your household" })
    expect(heading).toHaveClass('text-base', 'font-semibold')
    expect(screen.getByText(/abc/)).toBeInTheDocument()
  })

  it('reports the error and retries on Try again', async () => {
    const { captureClientError } = await import('@/lib/errors-client')
    const reset = vi.fn()
    const error = Object.assign(new Error('boom'), { digest: 'abc' })
    render(<HouseholdError error={error} reset={reset} />)

    expect(captureClientError).toHaveBeenCalledWith(error, { digest: 'abc' })
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
