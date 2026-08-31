import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Skeleton } from './skeleton'

describe('Skeleton', () => {
  it('announces itself as a busy status region', () => {
    render(<Skeleton className="h-4 w-24" />)

    const skeleton = screen.getByRole('status')
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
    expect(skeleton).toHaveAccessibleName('Loading')
  })

  it('merges className with the base styles', () => {
    render(<Skeleton className="h-9 w-full" />)

    expect(screen.getByRole('status')).toHaveClass('animate-pulse', 'h-9', 'w-full')
  })

  // HON-582: this `role="status"` is shared with every success banner in the
  // app, so an unscoped `getByRole('status')` in a Playwright spec matches each
  // loader on screen and fails strict mode instead of waiting for the banner.
  // Specs target `data-testid="form-success"` instead, which stays unambiguous
  // only while the skeleton itself carries no testid — giving this primitive a
  // default one would silently resurrect the race across every loading page.
  it('carries no test handle of its own, so a testid query cannot match it', () => {
    const { container } = render(
      <>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-full" />
      </>,
    )

    expect(screen.getAllByRole('status')).toHaveLength(2)
    expect(screen.queryByTestId('form-success')).toBeNull()
    expect(container.querySelectorAll('[data-testid]')).toHaveLength(0)
  })
})
