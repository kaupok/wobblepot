import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { fridgeItems } from '@/stories/fridge-fixtures'

import { FridgeCompleteDialog } from './FridgeCompleteDialog'

function renderDialog(isLoading = false) {
  const onConfirm = vi.fn()
  render(
    <FridgeCompleteDialog
      open
      onOpenChange={vi.fn()}
      items={fridgeItems}
      onConfirm={onConfirm}
      isLoading={isLoading}
    />,
  )
  const dialog = within(screen.getByRole('dialog', { name: 'Did you use anything up?' }))
  return { dialog, onConfirm, user: userEvent.setup() }
}

describe('FridgeCompleteDialog', () => {
  it('lists one "Used it all" tick per pantry item, none ticked', () => {
    const { dialog } = renderDialog()

    const ticks = dialog.getAllByRole('checkbox')
    expect(ticks.map((tick) => tick.getAttribute('aria-label'))).toEqual([
      'Used it all: Cauliflower and broccoli mix',
      'Used it all: Cucumber',
    ])
    expect(ticks.every((tick) => tick.getAttribute('aria-checked') === 'false')).toBe(true)
    // The leftovers and the free text are not in the pantry.
    expect(dialog.queryByText('store meatballs')).not.toBeInTheDocument()
    expect(dialog.queryByText('Mash, from Tuesday')).not.toBeInTheDocument()
  })

  it('confirms with the ticked ingredients only', async () => {
    const { dialog, onConfirm, user } = renderDialog()

    await user.click(dialog.getByRole('checkbox', { name: 'Used it all: Cucumber' }))
    await user.click(dialog.getByRole('button', { name: 'Done' }))

    expect(onConfirm).toHaveBeenCalledWith(['cucumber'])
  })

  // A 20px checkbox is small for a thumb (HON-1287).
  it('toggles the tick from a click on the item name, in a 44px row', async () => {
    const { dialog, onConfirm, user } = renderDialog()

    const tick = dialog.getByRole('checkbox', { name: 'Used it all: Cucumber' })
    // Cucumber is the second pantry row.
    expect(dialog.getAllByRole('listitem')[1]).toHaveClass('min-h-touch')
    await user.click(dialog.getByText('Cucumber'))
    expect(tick).toHaveAttribute('aria-checked', 'true')
    await user.click(dialog.getByText('Cucumber'))
    expect(tick).toHaveAttribute('aria-checked', 'false')
    await user.click(dialog.getAllByText('Used it all')[0]!)
    await user.click(dialog.getByRole('button', { name: 'Done' }))

    expect(onConfirm).toHaveBeenCalledWith(['veg-mix'])
  })

  it('confirms with no ids when nothing is ticked', async () => {
    const { dialog, onConfirm, user } = renderDialog()

    await user.click(dialog.getByRole('button', { name: 'Done' }))

    expect(onConfirm).toHaveBeenCalledWith([])
  })

  it('ignores a second confirm while the first is saving', async () => {
    const { dialog, onConfirm, user } = renderDialog(true)

    await user.click(dialog.getByRole('button', { name: 'Saving…' }))

    expect(onConfirm).not.toHaveBeenCalled()
  })
})
