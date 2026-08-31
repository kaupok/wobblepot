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

  // HON-582: the skeleton's `role="status"` collides with every success banner
  // in the app, so an unscoped `getByRole('status')` in a Playwright spec matches
  // each loader on screen and fails strict mode instead of waiting for the
  // banner. E2E specs target `data-testid="form-success"` instead — a locator
  // that only works while nothing else claims a testid. Adding a default one
  // here (or letting a caller pass `form-success` through) would silently
  // resurrect the race, so keep the skeleton anonymous to testid queries.
  it('exposes no test handle of its own, so testid queries cannot match it', () => {
    const { container } = render(
      <>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-full" />
      </>,
    )

    expect(screen.getAllByRole('status')).toHaveLength(2)
    expect(container.querySelectorAll('[data-testid]')).toHaveLength(0)
  })
})
