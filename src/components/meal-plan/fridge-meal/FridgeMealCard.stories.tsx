import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { fridgeItems, fridgePantryItems } from '@/stories/fridge-fixtures'
import { FridgeMealCard } from './FridgeMealCard'

const meta = {
  title: 'Meal plan/Fridge meal/FridgeMealCard',
  component: FridgeMealCard,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A planned fridge meal on the timeline (HON-1277): the title and the items, editable until the meal is eaten. No cook view, tips, cook questions or rating.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
  args: {
    entryId: 'entry-1',
    planId: 'plan-1',
    date: '2026-10-21',
    mealType: 'dinner',
    status: 'planned',
    items: fridgeItems,
    pantryItems: fridgePantryItems,
  },
} satisfies Meta<typeof FridgeMealCard>

export default meta
type Story = StoryObj<typeof meta>

async function openMenu(canvasElement: HTMLElement) {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: 'More actions: Fridge meal' }),
  )
  return within(await within(document.body).findByRole('menu'))
}

const itemNames = (menu: ReturnType<typeof within>) =>
  menu.getAllByRole('menuitem').map((item: HTMLElement) => item.textContent)

export const Planned: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'Fridge meal' })).toBeInTheDocument()
    await expect(canvas.getByText('Mash, from Tuesday')).toBeInTheDocument()
    const menu = await openMenu(canvasElement)
    await expect(itemNames(menu)).toEqual(['Eaten', 'Edit items', 'Clear'])
  },
}

export const WithNote: Story = {
  args: { note: 'Heat the mash first' },
}

/** Eaten: no edit or clear, and no rating prompt. */
export const Eaten: Story = {
  args: { status: 'completed', note: 'Heat the mash first' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByText('How was it?')).toBeNull()
    const menu = await openMenu(canvasElement)
    await expect(itemNames(menu)).toEqual(['Not eaten yet'])
  },
}

/** "Eaten" opens the "Used it all" dialog; Done completes and focus returns to ⋯. */
export const CompleteWithDialog: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const menu = await openMenu(canvasElement)
    await userEvent.click(menu.getByRole('menuitem', { name: 'Eaten' }))
    const dialog = within(
      await within(document.body).findByRole('dialog', { name: 'Did you use anything up?' }),
    )
    await userEvent.click(dialog.getByRole('checkbox', { name: 'Used it all: Cucumber' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Done' }))
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'More actions: Fridge meal' })).toHaveFocus(),
    )
    await expect(canvas.getByText('Eaten', { exact: true })).toBeInTheDocument()
  },
}

/** "Edit items" opens the picker on the meal's items. */
export const EditItems: Story = {
  play: async ({ canvasElement }) => {
    const menu = await openMenu(canvasElement)
    await userEvent.click(menu.getByRole('menuitem', { name: 'Edit items' }))
    const dialog = within(await within(document.body).findByRole('dialog', { name: 'Fridge meal' }))
    await expect(dialog.getByRole('button', { name: 'Remove: Cucumber' })).toBeInTheDocument()
  },
}
