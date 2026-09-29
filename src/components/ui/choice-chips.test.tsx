import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { ChoiceChips } from './choice-chips'

const OPTIONS = [
  { value: 'adult', label: 'Adult' },
  { value: 'child', label: 'Child' },
]

describe('ChoiceChips', () => {
  it('renders a named radiogroup with one radio per option', () => {
    render(
      <ChoiceChips
        aria-label="Member type"
        value="adult"
        onValueChange={vi.fn()}
        options={OPTIONS}
      />,
    )
    const group = screen.getByRole('radiogroup', { name: 'Member type' })
    expect(group).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.getByRole('radio', { name: 'Adult' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Child' })).toHaveAttribute('aria-checked', 'false')
  })

  it('fires onValueChange with the option value', async () => {
    const onValueChange = vi.fn()
    render(
      <ChoiceChips
        aria-label="Member type"
        value="adult"
        onValueChange={onValueChange}
        options={OPTIONS}
      />,
    )
    await userEvent.click(screen.getByRole('radio', { name: 'Child' }))
    expect(onValueChange).toHaveBeenCalledWith('child')
  })

  it('shows the check icon on the selected chip only', () => {
    render(
      <ChoiceChips
        aria-label="Member type"
        value="child"
        onValueChange={vi.fn()}
        options={OPTIONS}
      />,
    )
    expect(screen.getByRole('radio', { name: 'Child' }).querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('radio', { name: 'Adult' }).querySelector('svg')).toBeNull()
  })

  it('checks nothing when the value matches no option, even after a selection', async () => {
    // A custom portion typed into the input next to the presets matches no
    // chip; the group must not keep showing the last preset as checked.
    function Harness() {
      const [value, setValue] = useState<string | undefined>(undefined)
      return (
        <>
          <ChoiceChips
            aria-label="Member type"
            value={value}
            onValueChange={setValue}
            options={OPTIONS}
          />
          <button type="button" onClick={() => setValue(undefined)}>
            Clear
          </button>
        </>
      )
    }
    render(<Harness />)
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-checked', 'false')
    }

    await userEvent.click(screen.getByRole('radio', { name: 'Child' }))
    expect(screen.getByRole('radio', { name: 'Child' })).toHaveAttribute('aria-checked', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-checked', 'false')
      expect(radio.querySelector('svg')).toBeNull()
    }
  })

  it('disables every chip when disabled', () => {
    render(
      <ChoiceChips
        aria-label="Member type"
        value="adult"
        onValueChange={vi.fn()}
        options={OPTIONS}
        disabled
      />,
    )
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
  })

  it('takes the Button heights for each size', () => {
    const { rerender } = render(
      <ChoiceChips aria-label="Type" value="adult" onValueChange={vi.fn()} options={OPTIONS} />,
    )
    expect(screen.getByRole('radio', { name: 'Adult' })).toHaveClass('h-touch', 'md:h-10')

    rerender(
      <ChoiceChips
        aria-label="Type"
        size="sm"
        value="adult"
        onValueChange={vi.fn()}
        options={OPTIONS}
      />,
    )
    expect(screen.getByRole('radio', { name: 'Adult' })).toHaveClass('h-8')
  })
})
