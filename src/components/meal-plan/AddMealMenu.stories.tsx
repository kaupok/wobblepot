import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AddMealMenu } from './AddMealMenu'

const meta = {
  title: 'Meal plan/AddMealMenu',
  component: AddMealMenu,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'The routes to a meal for an open slot, on the empty slot\'s button and the cleared card\'s "Add meal" (HON-1247). The caller passes the trigger and opens the selector in the chosen view, or, for "Pick for me", fills the slot itself (HON-1248).',
      },
    },
  },
  args: {
    onChoose: fn(),
    children: (
      <Button variant="ghost" size="sm">
        <Plus aria-hidden="true" />
        Lunch
      </Button>
    ),
  },
} satisfies Meta<typeof AddMealMenu>

export default meta
type Story = StoryObj<typeof meta>

const trigger = (canvasElement: HTMLElement) =>
  within(canvasElement).getByRole('button', { name: 'Lunch' })

export const Closed: Story = {
  play: async ({ canvasElement }) => {
    await expect(trigger(canvasElement)).toHaveAttribute('aria-expanded', 'false')
    await expect(within(document.body).queryByRole('menu')).toBeNull()
  },
}

export const Open: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(trigger(canvasElement))
    const menu = within(await within(document.body).findByRole('menu'))
    const items = menu.getAllByRole('menuitem')
    await expect(items.map((item) => item.textContent)).toEqual([
      'Choose a recipe',
      'Pick for me',
      'Imagine a meal',
    ])
    await expect(args.onChoose).not.toHaveBeenCalled()
  },
}

export const ChoosesImagine: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(trigger(canvasElement))
    await userEvent.click(
      await within(document.body).findByRole('menuitem', { name: 'Imagine a meal' }),
    )
    await expect(args.onChoose).toHaveBeenCalledWith('imagine')
  },
}

/** "Pick for me" fills the slot with no dialog (HON-1248). */
export const ChoosesPick: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(trigger(canvasElement))
    await userEvent.click(
      await within(document.body).findByRole('menuitem', { name: 'Pick for me' }),
    )
    await expect(args.onChoose).toHaveBeenCalledWith('pick')
  },
}

/** While the slot's placeholder is created or discarded the menu stays shut. */
export const Disabled: Story = {
  args: {
    disabled: true,
    children: (
      <Button variant="ghost" size="sm" aria-disabled="true">
        <Plus aria-hidden="true" />
        Lunch
      </Button>
    ),
  },
  // `aria-disabled` turns pointer events off, so Enter and Space are the
  // paths left to the menu.
  play: async ({ canvasElement }) => {
    trigger(canvasElement).focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    await expect(within(document.body).queryByRole('menu')).toBeNull()
    await expect(trigger(canvasElement)).toHaveFocus()
  },
}

export const Estonian: Story = {
  globals: { locale: 'et' },
  play: async ({ canvasElement }) => {
    await userEvent.click(trigger(canvasElement))
    const menu = within(await within(document.body).findByRole('menu'))
    await expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Vali retsept',
      'Vali minu eest',
      'Mõtle välja toit',
    ])
  },
}
