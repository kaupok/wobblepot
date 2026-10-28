import { createRef } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { MealCardMenu } from './MealCardMenu'
import type { LeftoverLunchOption } from './leftover-lunch-option'

// "Cook for tomorrow's lunch too" in a planned dinner's ⋯ menu (HON-1396). The
// dialog's request is tested in `CookForLunchDialog.test.tsx`.

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

function renderMenu(option?: LeftoverLunchOption, status: 'planned' | 'completed' = 'planned') {
  const triggerRef = createRef<HTMLButtonElement>()
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <MealCardMenu
        mealName="Chicken curry"
        status={status}
        triggerRef={triggerRef}
        isUpdating={false}
        isClearing={false}
        onNote={vi.fn()}
        focusNote={vi.fn()}
        onComplete={vi.fn()}
        onStatusChange={vi.fn()}
        onSwap={vi.fn()}
        onClear={vi.fn()}
        cookForLunch={
          option && { option, planId: 'plan-1', entryId: 'entry-curry', householdServings: 2.5 }
        }
      />
    </Wrapper>,
  )
  return { triggerRef, user: userEvent.setup() }
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /more actions.*chicken curry/i }))
  return within(await screen.findByRole('menu'))
}

describe("MealCardMenu: Cook for tomorrow's lunch too", () => {
  it('opens the servings dialog, and returns focus to ⋯ when it closes', async () => {
    const { triggerRef, user } = renderMenu({ state: 'available' })
    const menu = await openMenu(user)

    await user.click(menu.getByRole('menuitem', { name: "Cook for tomorrow's lunch too" }))

    const dialog = await screen.findByRole('dialog', { name: "Cook for tomorrow's lunch too" })
    expect(within(dialog).getByText('2.5 servings')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(triggerRef.current).toHaveFocus()
  })

  it.each([
    ['recipeLunch', "Tomorrow's lunch is already a recipe meal."],
    ['cooked', "Tomorrow's lunch is already cooked."],
    [
      'lunchOff',
      'Lunch is off for that day. Turn it on in Household → Meal preferences → Meals to plan.',
    ],
  ] as const)('is shown unavailable with the reason when %s', async (reason, text) => {
    const { user } = renderMenu({ state: 'unavailable', reason })
    const menu = await openMenu(user)

    const item = menu.getByRole('menuitem', { name: new RegExp("Cook for tomorrow's lunch too") })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent(text)
    await user.click(item)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  // A keyboard user arrows to the item and hears the reason, which Radix's
  // `disabled` would skip; Enter and Space run nothing (HON-1426).
  it.each([
    ['recipeLunch', "Tomorrow's lunch is already a recipe meal."],
    ['cooked', "Tomorrow's lunch is already cooked."],
    [
      'lunchOff',
      'Lunch is off for that day. Turn it on in Household → Meal preferences → Meals to plan.',
    ],
  ] as const)('takes keyboard focus with the reason when %s', async (reason, text) => {
    const { user } = renderMenu({ state: 'unavailable', reason })
    screen.getByRole('button', { name: /more actions.*chicken curry/i }).focus()
    await user.keyboard('{Enter}')
    const menu = within(await screen.findByRole('menu'))

    // Note, Cooked, Skipped, then the lunch item.
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    const item = menu.getByRole('menuitem', {
      name: (name) => name.startsWith("Cook for tomorrow's lunch too") && name.includes(text),
    })
    expect(item).toHaveFocus()

    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(item).toHaveFocus()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('is not shown without an option, or on a cooked meal', async () => {
    const first = renderMenu()
    let menu = await openMenu(first.user)
    expect(menu.queryByRole('menuitem', { name: /tomorrow's lunch/ })).not.toBeInTheDocument()
    await first.user.keyboard('{Escape}')
    document.body.innerHTML = ''

    const second = renderMenu({ state: 'available' }, 'completed')
    menu = await openMenu(second.user)
    expect(menu.queryByRole('menuitem', { name: /tomorrow's lunch/ })).not.toBeInTheDocument()
  })
})
