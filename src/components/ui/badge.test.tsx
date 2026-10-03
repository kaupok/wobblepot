import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Badge, badgeVariants } from './badge'

// A synthetic hover does not reach CSS `:hover` in a browser story, so the
// hover look of a surface badge that is a button (HON-1032) is asserted here.
const SURFACE_BUTTON_CLASSES = [
  '[button&]:enabled:cursor-pointer',
  '[button&]:enabled:hover:bg-accent',
  '[button&]:enabled:hover:text-accent-foreground',
  'dark:[button&]:enabled:hover:bg-accent/50',
]

describe('Badge', () => {
  it('renders a span by default', () => {
    render(<Badge>New</Badge>)
    expect(screen.getByText('New').tagName).toBe('SPAN')
  })

  it.each(['surface', 'surface-success', 'surface-warning'] as const)(
    'gives a %s badge the ghost hover and a pointer, scoped to an enabled button',
    (variant) => {
      render(
        <Badge asChild variant={variant}>
          <button type="button">Serves 4</button>
        </Badge>,
      )
      expect(screen.getByRole('button', { name: 'Serves 4' })).toHaveClass(
        ...SURFACE_BUTTON_CLASSES,
      )
    },
  )

  it('scopes every hover and cursor class of the surface variants to an enabled button', () => {
    // An unscoped class would reach the span badges (the time, the pantry
    // status), which are not actions.
    const classes = badgeVariants({ variant: 'surface' }).split(' ')
    const interactive = classes.filter((c) => /hover:|cursor-/.test(c))
    expect(interactive).toEqual(SURFACE_BUTTON_CLASSES)
  })

  it('fades the background with the colour', () => {
    expect(badgeVariants()).toContain('transition-[color,background-color,box-shadow]')
  })
})
