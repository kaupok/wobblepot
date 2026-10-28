import { useRef } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
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
          "A planned card's ⋯ menu: Note, the status, the Swap routes and Clear behind one trigger. The Swap group offers the open slot's routes in its words (HON-1249). The items follow the entry's status; a completed entry cannot be swapped or cleared (HON-633, HON-1123).",
      },
    },
  },
  args: {
    mealName: 'Lemon garlic chicken',
    status: 'planned',
    // Replaced in `render`: a shared ref arg holding the trigger's DOM node
    // overflowed the stack from the seventh story on.
    triggerRef: { current: null },
    isUpdating: false,
    isClearing: false,
    onNote: fn(),
    focusNote: fn(),
    onComplete: fn(),
    onStatusChange: fn(),
    onSwap: fn(),
    onClear: fn(),
  },
  render: function Render(args) {
    const triggerRef = useRef<HTMLButtonElement>(null)
    return <MealCardMenu {...args} triggerRef={triggerRef} />
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

const ROUTES = ['Choose a recipe', 'Pick for me', 'Imagine a meal', 'Fridge meal']

export const Planned: Story = {
  play: async ({ canvasElement, args }) => {
    const menu = await openMenu(canvasElement)
    await expect(itemNames(menu)).toEqual(['Note', 'Cooked', 'Skipped', ...ROUTES, 'Clear'])
    // The routes sit under a "Swap" label, and the group takes its name.
    const group = within(menu.getByRole('group', { name: 'Swap' }))
    await expect(itemNames(group)).toEqual(ROUTES)
    await expect(menu.queryByRole('menuitem', { name: 'Swap' })).toBeNull()
    await userEvent.click(menu.getByRole('menuitem', { name: 'Imagine a meal' }))
    await expect(args.onSwap).toHaveBeenCalledWith('imagine')
  },
}

export const ChoosesPick: Story = {
  play: async ({ canvasElement, args }) => {
    const menu = await openMenu(canvasElement)
    await userEvent.click(menu.getByRole('menuitem', { name: 'Pick for me' }))
    await expect(args.onSwap).toHaveBeenCalledWith('pick')
  },
}

/** While "Pick for me" places a meal, its item waits; the other routes stay open. */
export const Picking: Story = {
  args: { isPicking: true },
  play: async ({ canvasElement }) => {
    const menu = await openMenu(canvasElement)
    await expect(menu.getByRole('menuitem', { name: 'Pick for me' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await expect(menu.getByRole('menuitem', { name: 'Choose a recipe' })).not.toHaveAttribute(
      'aria-disabled',
    )
  },
}

/** A cooked meal goes back with "Not cooked yet", and is neither swapped nor cleared. */
export const Completed: Story = {
  args: { status: 'completed' },
  play: async ({ canvasElement }) => {
    const menu = await openMenu(canvasElement)
    await expect(itemNames(menu)).toEqual(['Note', 'Not cooked yet'])
    await expect(menu.queryByRole('group', { name: 'Swap' })).toBeNull()
  },
}

export const Skipped: Story = {
  args: { status: 'skipped' },
  play: async ({ canvasElement, args }) => {
    const menu = await openMenu(canvasElement)
    await expect(itemNames(menu)).toEqual(['Note', 'Not skipped', ...ROUTES, 'Clear'])
    await userEvent.click(menu.getByRole('menuitem', { name: 'Not skipped' }))
    await expect(args.onStatusChange).toHaveBeenCalledWith('planned')
  },
}

export const Estonian: Story = {
  globals: { locale: 'et' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button'))
    const menu = within(await within(document.body).findByRole('menu'))
    const group = within(menu.getByRole('group', { name: 'Vaheta' }))
    await expect(itemNames(group)).toEqual([
      'Vali retsept',
      'Vali minu eest',
      'Mõtle välja toit',
      'Külmkapitoit',
    ])
  },
}

/** A planned recipe dinner offers "Cook for tomorrow's lunch too" (HON-1396). */
export const CookForLunch: Story = {
  args: {
    cookForLunch: {
      option: { state: 'available' },
      planId: 'plan-1',
      entryId: 'entry-1',
      householdServings: 2.5,
    },
  },
  play: async ({ canvasElement }) => {
    const menu = await openMenu(canvasElement)
    await userEvent.click(menu.getByRole('menuitem', { name: "Cook for tomorrow's lunch too" }))
    const dialog = await within(document.body).findByRole('dialog', {
      name: "Cook for tomorrow's lunch too",
    })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
  },
}

/** Lunch is off for the next day: the item says how to turn it on (HON-1396). */
export const CookForLunchUnavailable: Story = {
  args: {
    cookForLunch: {
      option: { state: 'unavailable', reason: 'lunchOff' },
      planId: 'plan-1',
      entryId: 'entry-1',
      householdServings: 2.5,
    },
  },
  play: async ({ canvasElement }) => {
    const menu = await openMenu(canvasElement)
    const item = menu.getByRole('menuitem', { name: /Cook for tomorrow's lunch too/ })
    await expect(item).toHaveAttribute('aria-disabled', 'true')
    await expect(item).toHaveTextContent('Meal preferences → Meals to plan')
  },
}
