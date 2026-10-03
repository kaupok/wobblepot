import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import mealIllustration from '@/stories/assets/meal-illustration-white.png'
import { createMeal } from '@/stories/fixtures'
import { assertFocusInDialog, awaitDialogClosed, pressEscape } from '@/stories/a11y-helpers'
import type { DemoDay } from '@/lib/landing/load-demo-day'
import { LandingDemo } from './LandingDemo'

const day: DemoDay = {
  date: '2026-10-01',
  meals: [
    {
      mealType: 'breakfast',
      servings: 4,
      steps: {
        equipment: ['Toaster', 'Small pan'],
        steps: ['Toast the bread', 'Mash the avocado with lemon and salt', 'Poach the eggs'],
        pitfalls: ['Old bread goes soggy under the avocado'],
        tip: 'Add the egg last so the yolk stays runny.',
      },
      meal: createMeal({
        id: 'demo-breakfast',
        name: 'Avocado toast with poached egg',
        description: 'Sourdough with smashed avocado and a poached egg',
        primaryProteinType: 'eggs',
        timeMinutes: 15,
        imageStatus: 'ready',
        imageUrl: mealIllustration.src,
        imageHue: 93,
      }),
    },
    {
      mealType: 'lunch',
      servings: 4,
      steps: { steps: ['Cook the rice', 'Fry the beef', 'Top with the egg'], pitfalls: [] },
      meal: createMeal({
        id: 'demo-lunch',
        name: 'Beef bibimbap',
        description: 'Korean rice bowl with beef and vegetables',
        primaryProteinType: 'beef',
        timeMinutes: 35,
        imageStatus: 'ready',
        imageUrl: mealIllustration.src,
        imageHue: 51,
      }),
    },
    {
      mealType: 'dinner',
      servings: 4,
      steps: { steps: ['Heat the oven', 'Roast the salmon and asparagus'], pitfalls: [] },
      meal: createMeal({
        id: 'demo-dinner',
        name: 'Baked salmon with asparagus',
        description: 'Oven-baked salmon with roasted asparagus and lemon',
        primaryProteinType: 'fish',
        timeMinutes: 30,
        imageStatus: 'ready',
        imageUrl: mealIllustration.src,
        imageHue: 66,
      }),
    },
  ],
}

const meta = {
  title: 'Landing/LandingDemo',
  component: LandingDemo,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "Today's three library meals on the signed-out home page, drawn with the planner card. A click on a name, or anywhere else on its card, opens the real cook view in `readOnly` mode: the pre-written steps, the ingredients and nutrition, and none of the controls that write (note, servings, pantry toggles, Ask, Done cooking).",
      },
    },
  },
  args: { day, dayLabel: 'Thursday' },
} satisfies Meta<typeof LandingDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Thursday')).toBeInTheDocument()
    await expect(canvas.getAllByRole('button')).toHaveLength(3)
  },
}

/** A name opens the cook view with the steps already there and nothing to write. */
export const OpensCookView: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Avocado toast with poached egg' }))
    const dialog = await within(document.body).findByRole('dialog')
    await expect(
      within(dialog).getByRole('heading', { name: 'Avocado toast with poached egg' }),
    ).toBeInTheDocument()
    await expect(within(dialog).getByText('Poach the eggs')).toBeInTheDocument()
    await expect(within(dialog).queryByRole('button', { name: /done cooking/i })).toBeNull()
    await expect(within(dialog).queryByRole('button', { name: /ask about step/i })).toBeNull()
    await expect(within(dialog).queryByRole('button', { name: /more actions/i })).toBeNull()
    await expect(within(dialog).queryAllByRole('checkbox')).toHaveLength(0)
    await assertFocusInDialog()
    await pressEscape()
    await awaitDialogClosed()
  },
}

/**
 * A click anywhere on the card opens its meal, as on the planner card
 * (HON-1036): a pointer cursor, the name's focus ring drawn around the card.
 * The name stays the only button, and the cook view hands focus back to it on
 * close.
 */
export const CardClickOpensCookView: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const name = canvas.getByRole('button', { name: 'Beef bibimbap' })
    const card = name.closest<HTMLElement>('[data-slot="card"]')
    await expect(card).not.toBeNull()
    await expect(getComputedStyle(card!).cursor).toBe('pointer')
    // The name's focus ring is drawn around the card, not on the name.
    name.focus()
    await expect(name.matches(':focus-visible')).toBe(true)
    await expect(getComputedStyle(card!).boxShadow).not.toBe('none')
    await expect(getComputedStyle(name).outlineStyle).toBe('none')
    name.blur()
    await userEvent.click(card!)
    const dialog = await within(document.body).findByRole('dialog')
    await expect(within(dialog).getByRole('heading', { name: 'Beef bibimbap' })).toBeInTheDocument()
    await assertFocusInDialog()
    await pressEscape()
    await awaitDialogClosed()
    await waitFor(() => expect(name).toHaveFocus())
  },
}
