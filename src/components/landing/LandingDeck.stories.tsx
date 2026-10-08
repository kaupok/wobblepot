import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import mealIllustration from '@/stories/assets/meal-illustration-white.png'
import { createMeal } from '@/stories/fixtures'
import { assertFocusInDialog, awaitDialogClosed, pressEscape } from '@/stories/a11y-helpers'
import type { DemoDay } from '@/lib/landing/load-demo-day'
import { LandingDeck } from './LandingDeck'

const day: DemoDay = {
  date: '2026-10-05',
  meals: [
    {
      mealType: 'breakfast',
      servings: 2.5,
      steps: { steps: ['Toast the bread', 'Poach the eggs'], pitfalls: [] },
      meal: createMeal({
        id: 'deck-breakfast',
        name: 'Avocado toast with poached egg',
        primaryProteinType: 'eggs',
        imageStatus: 'ready',
        imageUrl: mealIllustration.src,
        imageHue: 93,
      }),
    },
    {
      mealType: 'lunch',
      servings: 2.5,
      steps: { steps: ['Cook the rice', 'Fry the beef'], pitfalls: [] },
      meal: createMeal({
        id: 'deck-lunch',
        name: 'Beef bibimbap',
        primaryProteinType: 'beef',
        imageStatus: 'ready',
        imageUrl: mealIllustration.src,
        imageHue: 51,
      }),
    },
    {
      mealType: 'dinner',
      servings: 2.5,
      steps: { steps: ['Brown the mince', 'Simmer the sauce for 30 minutes'], pitfalls: [] },
      meal: createMeal({
        id: 'deck-dinner',
        name: 'Chilli con carne',
        description: 'Beef and beans in a mild tomato sauce, with rice',
        primaryProteinType: 'beef',
        timeMinutes: 45,
        imageStatus: 'ready',
        imageUrl: mealIllustration.src,
        imageHue: 30,
      }),
    },
  ],
}

const meta = {
  title: 'Landing/LandingDeck',
  component: LandingDeck,
  tags: ['autodocs'],
  // The side cards reach past the column, as in the hero, which clips them.
  decorators: [
    (Story) => (
      <div className="flex justify-center overflow-x-clip px-4 py-8">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "Landing direction B1's hero picture (HON-1116): tonight's dinner in front, breakfast and lunch tilted behind it. With a demo day the front card is the live landing's demo card (HON-1036) and opens the read-only cook view; the side cards are `inert` pictures. With no demo day the static showcase stands in and nothing opens.",
      },
    },
  },
  args: { day, caption: "Monday · Tonight's dinner" },
} satisfies Meta<typeof LandingDeck>

export default meta
type Story = StoryObj<typeof meta>

/** The demo dinner in front: one button, its name, and the hint above. */
export const Demo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("Monday · Tonight's dinner")).toBeInTheDocument()
    await expect(canvas.getByText(/Open a meal/)).toBeInTheDocument()
    await expect(canvas.getAllByRole('button')).toHaveLength(1)
    await expect(canvasElement.querySelectorAll('[inert]')).toHaveLength(2)
  },
}

/**
 * A click anywhere on the front card opens the cook view; Escape closes it and
 * focus returns to the dinner's name.
 */
export const OpensCookView: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const name = canvas.getByRole('button', { name: 'Chilli con carne' })
    const card = name.closest<HTMLElement>('[data-slot="card"]')
    await expect(card).not.toBeNull()
    await userEvent.click(card!)
    const dialog = await within(document.body).findByRole('dialog')
    await expect(within(dialog).getByText('Simmer the sauce for 30 minutes')).toBeInTheDocument()
    await assertFocusInDialog()
    await pressEscape()
    await awaitDialogClosed()
    await waitFor(() => expect(name).toHaveFocus())
  },
}

/** No demo day: the static showcase, with no hint and nothing to open. */
export const Static: Story = {
  args: { day: null, caption: "Thursday · Tonight's dinner" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Baked salmon with asparagus')).toBeInTheDocument()
    await expect(canvas.queryByText(/Open a meal/)).toBeNull()
    await expect(canvas.queryAllByRole('button')).toHaveLength(0)
  },
}

export const Dark: Story = { globals: { theme: 'dark' } }

/** From `md`: the side cards sit lower and further out, beside the front card. */
export const Desktop: Story = {
  globals: { viewport: { value: 'laptop', isRotated: false } },
}
