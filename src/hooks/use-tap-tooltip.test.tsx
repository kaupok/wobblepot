import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTapTooltip } from './use-tap-tooltip'

function Tip({ enabled = true }: { enabled?: boolean }) {
  const tap = useTapTooltip(enabled)
  return (
    <Tooltip {...tap.rootProps}>
      <TooltipTrigger asChild {...tap.triggerProps}>
        <button type="button">Trigger</button>
      </TooltipTrigger>
      <TooltipContent>Label</TooltipContent>
    </Tooltip>
  )
}

function tap(element: HTMLElement) {
  fireEvent.pointerDown(element, { pointerType: 'touch' })
  fireEvent.pointerUp(element, { pointerType: 'touch' })
  fireEvent.click(element)
}

describe('useTapTooltip', () => {
  it('opens on a tap and closes on the next tap', () => {
    render(<Tip />)
    const trigger = screen.getByRole('button', { name: 'Trigger' })

    tap(trigger)
    expect(trigger).toHaveAttribute('data-state', 'instant-open')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Label')

    tap(trigger)
    expect(trigger).toHaveAttribute('data-state', 'closed')
  })

  it('keeps Radix behaviour for a mouse click: it does not open', async () => {
    const user = userEvent.setup()
    render(<Tip />)
    const trigger = screen.getByRole('button', { name: 'Trigger' })

    fireEvent.pointerDown(trigger, { pointerType: 'mouse' })
    fireEvent.pointerUp(trigger, { pointerType: 'mouse' })
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('data-state', 'closed')

    // Keyboard focus still opens it.
    trigger.blur()
    await user.tab()
    expect(trigger).toHaveAttribute('data-state', 'instant-open')
  })

  it('does nothing on a tap when disabled', () => {
    render(<Tip enabled={false} />)
    const trigger = screen.getByRole('button', { name: 'Trigger' })

    tap(trigger)
    expect(trigger).toHaveAttribute('data-state', 'closed')
  })
})
