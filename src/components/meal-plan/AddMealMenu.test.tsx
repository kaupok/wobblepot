import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Button } from '@/components/ui/button'

import { AddMealMenu } from './AddMealMenu'

function renderMenu(props: { disabled?: boolean } = {}) {
  const onChoose = vi.fn()
  render(
    <AddMealMenu onChoose={onChoose} {...props}>
      <Button aria-disabled={props.disabled || undefined}>Lunch</Button>
    </AddMealMenu>,
  )
  return { onChoose, trigger: screen.getByRole('button', { name: 'Lunch' }) }
}

describe('AddMealMenu', () => {
  it('lists "Choose a recipe", "Pick for me", "Imagine a meal", then "Fridge meal"', async () => {
    const user = userEvent.setup()
    const { trigger } = renderMenu()

    await user.click(trigger)

    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'Choose a recipe',
      'Pick for me',
      'Imagine a meal',
      'Fridge meal',
    ])
  })

  it('opens from Enter on the trigger', async () => {
    const user = userEvent.setup()
    const { trigger } = renderMenu()

    trigger.focus()
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it.each([
    ['Choose a recipe', 'library'],
    ['Pick for me', 'pick'],
    ['Imagine a meal', 'imagine'],
    ['Fridge meal', 'fridge'],
  ])('passes the route for "%s"', async (name, view) => {
    const user = userEvent.setup()
    const { onChoose, trigger } = renderMenu()

    await user.click(trigger)
    await user.click(await screen.findByRole('menuitem', { name }))

    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onChoose).toHaveBeenCalledWith(view)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('stays closed while disabled, and the trigger keeps focus', async () => {
    const user = userEvent.setup()
    const { onChoose, trigger } = renderMenu({ disabled: true })

    await user.click(trigger)
    trigger.focus()
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toBeEnabled()
    expect(trigger).toHaveFocus()
    expect(onChoose).not.toHaveBeenCalled()
  })
})
