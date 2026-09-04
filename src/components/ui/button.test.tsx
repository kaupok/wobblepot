import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Button, buttonVariants } from './button'

describe('Button component', () => {
  it('renders children correctly', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
  })

  it('renders as a button element by default', () => {
    render(<Button>Default Button</Button>)
    const button = screen.getByRole('button')
    expect(button.tagName).toBe('BUTTON')
  })

  describe('variants', () => {
    it('applies default variant classes', () => {
      render(<Button>Default</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-primary', 'text-primary-foreground')
    })

    it('applies destructive variant classes', () => {
      render(<Button variant="destructive">Delete</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-destructive', 'text-white')
    })

    it('applies outline variant classes', () => {
      render(<Button variant="outline">Outline</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('border', 'bg-background', 'shadow-xs')
    })

    it('applies secondary variant classes', () => {
      render(<Button variant="secondary">Secondary</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-secondary', 'text-secondary-foreground')
    })

    it('applies ghost variant classes', () => {
      render(<Button variant="ghost">Ghost</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('hover:bg-accent')
    })

    it('applies link variant classes', () => {
      render(<Button variant="link">Link</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('text-primary', 'underline-offset-4')
    })
  })

  describe('sizes', () => {
    it('applies default size classes', () => {
      render(<Button>Default Size</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('h-touch', 'md:h-9', 'px-4', 'py-2')
    })

    it('applies small size classes', () => {
      render(<Button size="sm">Small</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('h-8')
    })

    it('applies large size classes', () => {
      render(<Button size="lg">Large</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('h-12', 'md:h-10')
    })

    it('applies icon size classes', () => {
      render(<Button size="icon" aria-label="Icon button" />)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('size-touch', 'md:size-9')
    })

    it('applies icon-sm size classes', () => {
      render(<Button size="icon-sm" aria-label="Small icon button" />)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('size-8')
    })

    it('applies icon-lg size classes', () => {
      render(<Button size="icon-lg" aria-label="Large icon button" />)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('size-12', 'md:size-10')
    })

    // The `sm` sizes are deliberately viewport-independent: they are for
    // secondary inline actions in card rows, where 44px zones with a 6px gap
    // would overlap (docs/DESIGN.md → Spacing, radius, elevation). Asserting
    // the absence of a breakpoint here is what makes that a decision rather
    // than an omission — the `toHaveClass('h-8')` above would stay green if
    // someone quietly made `sm` responsive too.
    it('keeps the sm sizes fixed across viewports', () => {
      for (const size of ['sm', 'icon-sm'] as const) {
        const classes = buttonVariants({ size })
        expect(classes).not.toMatch(/\bmd:/)
        expect(classes).not.toContain('touch')
      }
    })
  })

  describe('custom className', () => {
    it('merges custom className with variant classes', () => {
      render(<Button className="custom-class">Custom</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('custom-class')
      expect(button).toHaveClass('bg-primary') // default variant class
    })
  })

  describe('asChild prop', () => {
    it('renders as child component when asChild is true', () => {
      render(
        <Button asChild>
          <a href="/test">Link Button</a>
        </Button>,
      )
      const link = screen.getByRole('link')
      expect(link).toBeInTheDocument()
      expect(link).toHaveTextContent('Link Button')
      expect(link).toHaveAttribute('href', '/test')
    })

    it('applies button classes to child component', () => {
      render(
        <Button asChild variant="destructive">
          <a href="/delete">Delete Link</a>
        </Button>,
      )
      const link = screen.getByRole('link')
      expect(link).toHaveClass('bg-destructive', 'text-white')
    })
  })

  describe('disabled state', () => {
    it('applies disabled styles', () => {
      render(<Button disabled>Disabled</Button>)
      const button = screen.getByRole('button')
      expect(button).toBeDisabled()
      expect(button).toHaveClass('disabled:pointer-events-none', 'disabled:opacity-50')
    })
  })

  describe('HTML attributes', () => {
    it('defaults to type="button" to prevent accidental form submission', () => {
      render(<Button>Default Type</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('type', 'button')
    })

    it('allows explicit type="submit" for form submission', () => {
      render(<Button type="submit">Submit</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('type', 'submit')
    })

    it('passes through standard button attributes', () => {
      render(
        <Button type="submit" name="submit-button" value="submit">
          Submit
        </Button>,
      )
      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('type', 'submit')
      expect(button).toHaveAttribute('name', 'submit-button')
      expect(button).toHaveAttribute('value', 'submit')
    })

    it('includes data-slot attribute', () => {
      render(<Button>With Slot</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('data-slot', 'button')
    })
  })

  describe('accessibility', () => {
    it('supports aria-label', () => {
      render(<Button aria-label="Close dialog">X</Button>)
      const button = screen.getByRole('button', { name: 'Close dialog' })
      expect(button).toBeInTheDocument()
    })

    it('has focus-visible styles for keyboard navigation', () => {
      render(<Button>Focusable</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('focus-visible:border-ring', 'focus-visible:ring-ring/50')
    })

    it('has aria-invalid styles', () => {
      render(<Button aria-invalid="true">Invalid</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('aria-invalid:ring-destructive/20')
    })
  })
})

describe('buttonVariants', () => {
  it('generates correct classes for default variant', () => {
    const classes = buttonVariants()
    expect(classes).toContain('bg-primary')
    expect(classes).toContain('text-primary-foreground')
  })

  it('generates correct classes for destructive variant', () => {
    const classes = buttonVariants({ variant: 'destructive' })
    expect(classes).toContain('bg-destructive')
    expect(classes).toContain('text-white')
  })

  it('generates correct classes for custom size', () => {
    const classes = buttonVariants({ size: 'lg' })
    // Both halves, deliberately: `toContain` is a substring match, so a lone
    // `toContain('h-10')` stays green against `h-12 md:h-10` while silently no
    // longer covering the mobile height.
    expect(classes).toContain('h-12')
    expect(classes).toContain('md:h-10')
  })

  it('combines variant and size correctly', () => {
    const classes = buttonVariants({ variant: 'outline', size: 'sm' })
    expect(classes).toContain('border')
    expect(classes).toContain('h-8')
  })
})
