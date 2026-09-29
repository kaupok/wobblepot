import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { FieldError } from './FieldError'

describe('FieldError', () => {
  it('announces the message as an alert', () => {
    render(<FieldError>Something went wrong</FieldError>)
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
  })

  it('renders the paragraph level so a wrapped message keeps its line height', () => {
    render(<FieldError>Required</FieldError>)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveClass('text-sm', 'leading-normal', 'text-destructive')
    expect(alert).not.toHaveClass('leading-none')
  })

  it('forwards id so an input can reference it', () => {
    render(<FieldError id="form-error">Required</FieldError>)
    expect(screen.getByRole('alert')).toHaveAttribute('id', 'form-error')
  })
})
