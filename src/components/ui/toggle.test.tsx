import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { Toggle } from './toggle'

describe('Toggle', () => {
  it('renders a button with aria-pressed reflecting the pressed state', () => {
    const { rerender } = render(<Toggle aria-label="Bold">B</Toggle>)
    const toggle = screen.getByRole('button', { name: 'Bold' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle).toHaveAttribute('data-state', 'off')

    rerender(
      <Toggle aria-label="Bold" pressed>
        B
      </Toggle>,
    )
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).toHaveAttribute('data-state', 'on')
  })

  it('fires onPressedChange with the next state', async () => {
    const onPressedChange = vi.fn()
    render(
      <Toggle aria-label="Bold" pressed={false} onPressedChange={onPressedChange}>
        B
      </Toggle>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Bold' }))
    expect(onPressedChange).toHaveBeenCalledWith(true)
  })

  describe('tone', () => {
    it('defaults to the neutral accent pressed state', () => {
      render(<Toggle aria-label="Bold">B</Toggle>)
      expect(screen.getByRole('button')).toHaveClass(
        'data-[state=on]:bg-accent',
        'data-[state=on]:text-accent-foreground',
      )
    })

    it('tints the pressed state with success', () => {
      render(<Toggle aria-label="Like" tone="success" />)
      const toggle = screen.getByRole('button')
      expect(toggle).toHaveClass(
        'text-muted-foreground',
        'data-[state=on]:bg-success-muted',
        'data-[state=on]:text-success',
      )
      expect(toggle).not.toHaveClass('data-[state=on]:bg-accent')
    })

    it('tints the pressed state with destructive', () => {
      render(<Toggle aria-label="Dislike" tone="destructive" />)
      expect(screen.getByRole('button')).toHaveClass(
        'text-muted-foreground',
        'data-[state=on]:bg-destructive/10',
        'data-[state=on]:text-destructive',
      )
    })

    it('lets a toned toggle hover to foreground rather than muted', () => {
      render(<Toggle aria-label="Like" tone="success" />)
      const toggle = screen.getByRole('button')
      expect(toggle).toHaveClass('hover:text-foreground')
      expect(toggle).not.toHaveClass('hover:text-muted-foreground')
    })
  })

  describe('shape', () => {
    it('is rounded-md by default', () => {
      render(<Toggle aria-label="Bold" />)
      expect(screen.getByRole('button')).toHaveClass('rounded-md')
    })

    it('is rounded-full as a circle', () => {
      render(<Toggle aria-label="Bold" shape="circle" />)
      const toggle = screen.getByRole('button')
      expect(toggle).toHaveClass('rounded-full')
      expect(toggle).not.toHaveClass('rounded-md')
    })
  })

  describe('size', () => {
    it('uses the touch height by default', () => {
      render(<Toggle aria-label="Bold" />)
      expect(screen.getByRole('button')).toHaveClass('h-touch', 'min-w-touch', 'md:h-10')
    })

    it('is 32px at sm', () => {
      render(<Toggle aria-label="Bold" size="sm" />)
      expect(screen.getByRole('button')).toHaveClass('h-8', 'min-w-8')
    })
  })
})
