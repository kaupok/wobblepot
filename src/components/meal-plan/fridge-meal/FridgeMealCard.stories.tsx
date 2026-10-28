import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { fridgeItems, fridgePantryItems } from '@/stories/fridge-fixtures'
import mealIllustration from '@/stories/assets/meal-illustration-white.png'
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

/** The ⋯ menu names the card's items, so two fridge cards differ (HON-1287). */
const MORE_ACTIONS =
  'More actions: Fridge meal: Mash, from Tuesday, Cauliflower and broccoli mix, Cucumber, store meatballs'

async function openMenu(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: MORE_ACTIONS }))
  return within(await within(document.body).findByRole('menu'))
}

const itemNames = (menu: ReturnType<typeof within>) =>
  menu.getAllByRole('menuitem').map((item: HTMLElement) => item.textContent)

export const Planned: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { level: 3 })).toHaveTextContent(/^Mash$/)
    await expect(
      canvas.getByText('+ Cauliflower and broccoli mix, Cucumber, store meatballs'),
    ).toBeInTheDocument()
    await expect(canvas.getByText('Leftovers')).toBeInTheDocument()
    await expect(canvas.getByText('Nothing to buy')).toBeInTheDocument()
    const menu = await openMenu(canvasElement)
    await expect(itemNames(menu)).toEqual(['Note', 'Eaten', 'Edit items', 'Clear'])
  },
}

/** Leftovers with a picture: the card takes that meal's image and tint. */
export const LeftoversWithImage: Story = {
  args: {
    items: fridgeItems.map((item) =>
      item.sourceEntryId
        ? {
            ...item,
            image: {
              imageUrl: mealIllustration.src,
              imageStatus: 'ready' as const,
              imageHue: 40,
            },
          }
        : item,
    ),
  },
}

/** Free text only, no leftovers: the fixed fridge tint. */
export const FreeTextOnly: Story = {
  args: { items: fridgeItems.filter((item) => item.label !== null) },
}

/**
 * A long name on the fridge tint, at phone width: with no image to clear, the
 * name keeps the full row, so it wraps no earlier than it must and the card
 * stays one height with the recipe cards (docs/DESIGN.md → Composition rules).
 */
export const LongNameOnPhone: Story = {
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  args: {
    items: ['pelmeenid', 'sour cream', 'dill', 'rye bread', 'pickled cucumbers'].map(
      (label, index) => ({
        id: `item-${index}`,
        ingredientId: null,
        sourceEntryId: null,
        label,
        name: null,
        sourceDate: null,
      }),
    ),
  },
  play: async ({ canvasElement }) => {
    const heading = within(canvasElement).getByRole('heading', { level: 3 })
    const card = canvasElement.querySelector<HTMLElement>('[data-meal-surface="fridge"]')!
    // The image's cap would hold the name at half the card or less.
    await expect(heading.getBoundingClientRect().width).toBeGreaterThan(
      card.getBoundingClientRect().width * 0.6,
    )
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
    await waitFor(() => expect(canvas.getByRole('button', { name: MORE_ACTIONS })).toHaveFocus())
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
