import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InfoTip } from './info-tip'

const TEXT = 'Includes estimates for vague quantities'
const LABEL = 'About these numbers'

function renderTip() {
  render(<InfoTip label={LABEL}>{TEXT}</InfoTip>)
  return screen.getByRole('button', { name: LABEL })
}

// The text is also in the button's sr-only description, so the open state is
// read from the popover itself, not from the text being somewhere on the page.
async function expectOpen() {
  const popover = await screen.findByRole('dialog', { name: LABEL })
  expect(within(popover).getByText(TEXT)).toBeInTheDocument()
}

async function expectClosed() {
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

describe('InfoTip', () => {
  // The popover never takes focus, so this is how a screen reader hears it.
  it('describes the button with the same text, closed or open', () => {
    const trigger = renderTip()
    expect(trigger).toHaveAccessibleDescription(TEXT)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens on mouse hover and closes when the mouse leaves', async () => {
    const trigger = renderTip()

    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' })
    await expectOpen()

    fireEvent.pointerLeave(trigger, { pointerType: 'mouse' })
    await expectClosed()
  })

  // user-event dispatches a mouse pointerenter before the click, as a real
  // mouse does, so this is the desktop click path.
  it('stays open after a mouse click, and once pinned survives the mouse leaving', async () => {
    const user = userEvent.setup()
    const trigger = renderTip()

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expectOpen()

    await user.unhover(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  // A tap fires pointerenter too; if it opened the popover, the click that
  // follows would toggle it straight back shut.
  it('ignores pointerenter from touch, and a tap toggles it', async () => {
    const trigger = renderTip()

    fireEvent.pointerEnter(trigger, { pointerType: 'touch' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    await expectOpen()

    fireEvent.click(trigger)
    await expectClosed()
  })

  it('opens from the keyboard, and Escape closes it with focus left on the button', async () => {
    const user = userEvent.setup()
    const trigger = renderTip()

    await user.tab()
    expect(trigger).toHaveFocus()

    await user.keyboard('{Enter}')
    await expectOpen()
    // Opening does not move focus into the content.
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{Escape}')
    await expectClosed()
    expect(trigger).toHaveFocus()
  })
})
