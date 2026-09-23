import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { FieldError } from './FieldError'

describe('FieldError', () => {
  it('announces the message as an alert', () => {
    render(<FieldError>Something went wrong</FieldError>)
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
  })

  it('renders the small destructive level', () => {
    render(<FieldError>Required</FieldError>)
    expect(screen.getByRole('alert')).toHaveClass('text-sm', 'text-destructive')
  })

  it('forwards id so an input can reference it', () => {
    render(<FieldError id="form-error">Required</FieldError>)
    expect(screen.getByRole('alert')).toHaveAttribute('id', 'form-error')
  })
})
