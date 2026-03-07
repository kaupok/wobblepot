import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState, type EmptyStateVariant } from './EmptyState'

describe('EmptyState', () => {
  const variants: { variant: EmptyStateVariant; heading: string; button: string; href: string }[] =
    [
      {
        variant: 'no-plan',
        heading: 'No meal plan yet',
        button: 'Generate plan',
        href: '/meal-plan',
      },
      {
        variant: 'all-purchased',
        heading: 'All done!',
        button: 'View pantry',
        href: '/pantry',
      },
      {
        variant: 'nothing-needed',
        heading: 'Nothing to buy',
        button: 'View pantry',
        href: '/pantry',
      },
      {
        variant: 'error',
        heading: 'Something went wrong',
        button: 'Go to dashboard',
        href: '/meal-plan',
      },
    ]

  variants.forEach(({ variant, heading, button, href }) => {
    describe(`variant: ${variant}`, () => {
      it(`renders heading "${heading}"`, () => {
        render(<EmptyState variant={variant} />)
        expect(screen.getByText(heading)).toBeInTheDocument()
      })

      it(`renders button "${button}" linking to ${href}`, () => {
        render(<EmptyState variant={variant} />)
        const link = screen.getByRole('link', { name: button })
        expect(link).toBeInTheDocument()
        expect(link).toHaveAttribute('href', href)
      })
    })
  })
})
