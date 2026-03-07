import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MealStatusPrompt } from './MealStatusPrompt'

describe('MealStatusPrompt', () => {
  it('shows "Did you make" prompt for planned meals', () => {
    render(<MealStatusPrompt mealName="Chicken Rice Bowl" onMadeIt={vi.fn()} onSkipped={vi.fn()} />)
    expect(screen.getByText('Did you make Chicken Rice Bowl?')).toBeInTheDocument()
  })

  it('shows "Change status" prompt for completed meals', () => {
    render(
      <MealStatusPrompt
        mealName="Chicken Rice Bowl"
        onMadeIt={vi.fn()}
        onSkipped={vi.fn()}
        currentStatus="completed"
      />,
    )
    expect(screen.getByText('Change status for Chicken Rice Bowl?')).toBeInTheDocument()
  })

  it('shows "Change status" prompt for skipped meals', () => {
    render(
      <MealStatusPrompt
        mealName="Pasta"
        onMadeIt={vi.fn()}
        onSkipped={vi.fn()}
        currentStatus="skipped"
      />,
    )
    expect(screen.getByText('Change status for Pasta?')).toBeInTheDocument()
  })

  it('renders "Made it" and "Skipped" buttons', () => {
    render(<MealStatusPrompt mealName="Chicken Rice Bowl" onMadeIt={vi.fn()} onSkipped={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Made it' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skipped' })).toBeInTheDocument()
  })

  it('shows checkmark on "Made it" button when status is completed', () => {
    render(
      <MealStatusPrompt
        mealName="Chicken Rice Bowl"
        onMadeIt={vi.fn()}
        onSkipped={vi.fn()}
        currentStatus="completed"
      />,
    )
    expect(screen.getByRole('button', { name: /Made it/ })).toHaveTextContent('✓ Made it')
  })

  it('calls onMadeIt when "Made it" is clicked', async () => {
    const user = userEvent.setup()
    const onMadeIt = vi.fn()
    render(<MealStatusPrompt mealName="Bowl" onMadeIt={onMadeIt} onSkipped={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Made it' }))
    expect(onMadeIt).toHaveBeenCalledOnce()
  })

  it('calls onSkipped when "Skipped" is clicked', async () => {
    const user = userEvent.setup()
    const onSkipped = vi.fn()
    render(<MealStatusPrompt mealName="Bowl" onMadeIt={vi.fn()} onSkipped={onSkipped} />)

    await user.click(screen.getByRole('button', { name: 'Skipped' }))
    expect(onSkipped).toHaveBeenCalledOnce()
  })

  it('does not show "Reset to planned" for new prompt', () => {
    render(
      <MealStatusPrompt mealName="Bowl" onMadeIt={vi.fn()} onSkipped={vi.fn()} onReset={vi.fn()} />,
    )
    expect(screen.queryByRole('button', { name: 'Reset to planned' })).not.toBeInTheDocument()
  })

  it('shows "Reset to planned" when changing status with onReset', () => {
    render(
      <MealStatusPrompt
        mealName="Bowl"
        onMadeIt={vi.fn()}
        onSkipped={vi.fn()}
        onReset={vi.fn()}
        currentStatus="completed"
      />,
    )
    expect(screen.getByRole('button', { name: 'Reset to planned' })).toBeInTheDocument()
  })

  it('shows "Cancel" button when changing status with onCancel', () => {
    render(
      <MealStatusPrompt
        mealName="Bowl"
        onMadeIt={vi.fn()}
        onSkipped={vi.fn()}
        onCancel={vi.fn()}
        currentStatus="skipped"
      />,
    )
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('does not show "Cancel" for initial prompt', () => {
    render(
      <MealStatusPrompt
        mealName="Bowl"
        onMadeIt={vi.fn()}
        onSkipped={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('disables all buttons when disabled', () => {
    render(
      <MealStatusPrompt
        mealName="Bowl"
        onMadeIt={vi.fn()}
        onSkipped={vi.fn()}
        onReset={vi.fn()}
        onCancel={vi.fn()}
        currentStatus="completed"
        disabled
      />,
    )
    expect(screen.getByRole('button', { name: /Made it/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Skipped' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset to planned' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})
