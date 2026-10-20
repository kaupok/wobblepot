import { createRef } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { MealCardMenu } from './MealCardMenu'

const meta = {
  title: 'Meal plan/MealCardMenu',
  component: MealCardMenu,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          "A planned card's ⋯ menu: Note, the status, Swap and Clear behind one trigger. The items follow the entry's status; a completed entry cannot be swapped or cleared (HON-633, HON-1123).",
      },
    },
  },
  args: {
    mealName: 'Lemon garlic chicken',
    status: 'planned',
    triggerRef: createRef<HTMLButtonElement>(),
    isUpdating: false,
    isClearing: false,
    onNote: fn(),
    focusNote: fn(),
    onComplete: fn(),
    onStatusChange: fn(),
    onSwap: fn(),
    onClear: fn(),
  },
} satisfies Meta<typeof MealCardMenu>

export default meta
type Story = StoryObj<typeof meta>

async function openMenu(canvasElement: HTMLElement) {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: /more actions.*lemon garlic chicken/i }),
  )
  return within(await within(document.body).findByRole('menu'))
}

const itemNames = (menu: ReturnType<typeof within>) =>
  menu.getAllByRole('menuitem').map((item: HTMLElement) => item.textContent)

export const Planned: Story = {
  play: async ({ canvasElement, args }) => {
    const menu = await openMenu(canvasElement)
    await expect(itemNames(menu)).toEqual(['Note', 'Cooked', 'Skipped', 'Swap', 'Clear'])
    await userEvent.click(menu.getByRole('menuitem', { name: 'Swap' }))
    await expect(args.onSwap).toHaveBeenCalledOnce()
  },
}

/** A cooked meal goes back with "Not cooked yet", and is neither swapped nor cleared. */
export const Completed: Story = {
  args: { status: 'completed' },
  play: async ({ canvasElement }) => {
    const menu = await openMenu(canvasElement)
    await expect(itemNames(menu)).toEqual(['Note', 'Not cooked yet'])
  },
}

export const Skipped: Story = {
  args: { status: 'skipped' },
  play: async ({ canvasElement, args }) => {
    const menu = await openMenu(canvasElement)
    await expect(itemNames(menu)).toEqual(['Note', 'Not skipped', 'Swap', 'Clear'])
    await userEvent.click(menu.getByRole('menuitem', { name: 'Not skipped' }))
    await expect(args.onStatusChange).toHaveBeenCalledWith('planned')
  },
}
