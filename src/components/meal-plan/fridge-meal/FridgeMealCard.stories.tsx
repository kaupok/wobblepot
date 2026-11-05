import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import mealIllustration from '@/stories/assets/meal-illustration-white.png'
import { createIngredient, createMealComponent } from '@/stories/fixtures'
import {
  fridgeItems,
  fridgePantryItems,
  plannedLeftoverItem,
  skippedLeftoverItem,
} from '@/stories/fridge-fixtures'

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
    householdServings: 3,
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
    await expect(itemNames(menu)).toEqual(['Note', 'Add side', 'Eaten', 'Edit items', 'Clear'])
  },
}

/** A skipped fridge meal takes no side (HON-1617): the server refuses one. */
export const Skipped: Story = {
  args: { status: 'skipped' },
  play: async ({ canvasElement }) => {
    const menu = await openMenu(canvasElement)
    await expect(itemNames(menu)).toEqual(['Note', 'Eaten', 'Edit items', 'Clear'])
  },
}

/**
 * A fridge meal with a side (HON-1617): the side's line opens its menu, as on
 * a recipe card, and "Add side" opens the side picker.
 */
export const WithSide: Story = {
  args: {
    sides: [
      {
        entryId: 'side-salad',
        mealId: 'meal-salad',
        mealName: 'Pepper salad',
        servings: 3,
        cookServings: 3,
        status: 'planned',
        rating: null,
        servingOverride: null,
        pantryDeducted: false,
        components: [],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: '+ Pepper salad · 3' }))
    const sideMenu = within(await within(document.body).findByRole('menu'))
    await expect(itemNames(sideMenu)).toEqual(['Servings', 'Swap', 'Remove'])
    await userEvent.keyboard('{Escape}')
    const menu = await openMenu(canvasElement)
    await userEvent.click(menu.getByRole('menuitem', { name: 'Add side' }))
    await expect(
      await within(document.body).findByRole('dialog', { name: 'Add a side dish' }),
    ).toBeInTheDocument()
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
        servings: null,
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

/**
 * A fridge meal with a pepper salad on the side (HON-1616): after the "Used it
 * all" dialog, "Eaten" asks about the salad's pantry rows, as Cooked does.
 */
export const EatenWithSide: Story = {
  args: {
    sides: [
      {
        entryId: 'side-salad',
        mealId: 'meal-salad',
        mealName: 'Pepper salad',
        servings: 3,
        cookServings: 3,
        status: 'planned',
        rating: null,
        servingOverride: null,
        pantryDeducted: false,
        components: [
          createMealComponent({
            ingredientId: 'paprika',
            quantityPerServing: 1,
            ingredient: createIngredient({
              id: 'paprika',
              name: 'Paprika',
              category: 'vegetable',
              defaultUnit: 'g',
            }),
          }),
        ],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const menu = await openMenu(canvasElement)
    await userEvent.click(menu.getByRole('menuitem', { name: 'Eaten' }))
    const body = within(document.body)
    const dialog = within(await body.findByRole('dialog', { name: 'Did you use anything up?' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Done' }))
    const sides = within(await body.findByRole('dialog', { name: 'Mark as cooked' }))
    await expect(
      sides.getByRole('radiogroup', { name: 'What is left: Paprika' }),
    ).toBeInTheDocument()
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

/**
 * Tomorrow's lunch from tonight's dinner, still to cook (HON-1395): the
 * dinner is the name, and a line under it says which day it comes from.
 */
export const LeftoverFromPlannedDinner: Story = {
  args: { mealType: 'lunch', items: [plannedLeftoverItem, fridgeItems[2]!] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { level: 3 })).toHaveTextContent(/^Roast chicken$/)
    await expect(canvas.getByText('Leftovers from Tuesday')).toBeVisible()
    await expect(canvas.getByText('+ Cucumber')).toBeVisible()
  },
}

/** The dinner was skipped, so the lunch has nothing to eat: plan something else. */
export const LeftoverFromSkippedDinner: Story = {
  args: { mealType: 'lunch', items: [skippedLeftoverItem, fridgeItems[2]!] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/These leftovers won't exist/)).toBeVisible()
  },
}

export const LeftoverFromSkippedDinnerEstonian: Story = {
  ...LeftoverFromSkippedDinner,
  name: 'Leftover from skipped dinner (Estonian)',
  globals: { locale: 'et' },
  play: undefined,
}
