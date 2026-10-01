import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InfoTip } from './info-tip'

const TEXT = 'Includes estimates for vague quantities'

function renderTip() {
  render(<InfoTip label="About these numbers">{TEXT}</InfoTip>)
  return screen.getByRole('button', { name: 'About these numbers' })
}

describe('InfoTip', () => {
  it('opens on mouse hover and closes when the mouse leaves', async () => {
    const trigger = renderTip()

    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' })
    expect(await screen.findByText(TEXT)).toBeInTheDocument()

    fireEvent.pointerLeave(trigger, { pointerType: 'mouse' })
    await waitFor(() => expect(screen.queryByText(TEXT)).not.toBeInTheDocument())
  })

  // A tap fires pointerenter too; if it opened the popover, the click that
  // follows would toggle it straight back shut.
  it('ignores pointerenter from touch, and a tap toggles it', async () => {
    const trigger = renderTip()

    fireEvent.pointerEnter(trigger, { pointerType: 'touch' })
    expect(screen.queryByText(TEXT)).not.toBeInTheDocument()

    fireEvent.click(trigger)
    expect(await screen.findByText(TEXT)).toBeInTheDocument()

    fireEvent.click(trigger)
    await waitFor(() => expect(screen.queryByText(TEXT)).not.toBeInTheDocument())
  })

  it('opens from the keyboard, and Escape closes it with focus left on the button', async () => {
    const user = userEvent.setup()
    const trigger = renderTip()

    await user.tab()
    expect(trigger).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(await screen.findByText(TEXT)).toBeInTheDocument()
    // Opening does not move focus into the content.
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByText(TEXT)).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })
})
