import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Allergen } from '@/generated/prisma/enums'
import { AllergenPicker } from './AllergenPicker'

function Harness({
  initial = [],
  onChange = () => {},
  errorId,
}: {
  initial?: Allergen[]
  onChange?: (next: Allergen[]) => void
  errorId?: string
}) {
  const [value, setValue] = useState(initial)
  return (
    <AllergenPicker
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
      errorId={errorId}
    />
  )
}

describe('AllergenPicker', () => {
  it('labels the group and lists the nine allergens in order', () => {
    render(<Harness />)

    const group = screen.getByRole('group', { name: 'Allergens to avoid' })
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([
      'Gluten',
      'Dairy',
      'Eggs',
      'Tree nuts',
      'Peanuts',
      'Soy',
      'Fish',
      'Shellfish',
      'Sesame',
    ])
  })

  it('describes the group with the AI notice, which links to the privacy policy', () => {
    render(<Harness />)

    expect(screen.getByRole('group')).toHaveAccessibleDescription(
      'Allergens you tick here are sent to our AI provider so meal plans avoid them. See the privacy policy for details.',
    )
    expect(screen.getByRole('link', { name: 'privacy policy' })).toHaveAttribute('href', '/privacy')
  })

  it('adds the error element to the description', () => {
    render(
      <>
        <Harness errorId="save-error" />
        <p id="save-error">Could not save.</p>
      </>,
    )

    expect(screen.getByRole('group')).toHaveAccessibleDescription(/for details\. Could not save\.$/)
  })

  it('gives two pickers on one page their own ids', () => {
    render(
      <>
        <Harness />
        <Harness />
      </>,
    )

    const [first, second] = screen.getAllByRole('group')
    expect(first!.getAttribute('aria-labelledby')).not.toBe(second!.getAttribute('aria-labelledby'))
    expect(first!.getAttribute('aria-describedby')).not.toBe(
      second!.getAttribute('aria-describedby'),
    )
  })

  it('ticks and unticks an allergen', async () => {
    const onChange = vi.fn()
    render(<Harness initial={['gluten']} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Tree nuts' }))
    expect(onChange).toHaveBeenLastCalledWith(['gluten', 'nuts'])
    expect(screen.getByRole('button', { name: 'Tree nuts' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await userEvent.click(screen.getByRole('button', { name: 'Gluten' }))
    expect(onChange).toHaveBeenLastCalledWith(['nuts'])
  })

  it('disables every toggle', () => {
    render(<AllergenPicker value={[]} onChange={() => {}} disabled />)

    for (const toggle of screen.getAllByRole('button')) expect(toggle).toBeDisabled()
  })
})
