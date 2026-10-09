import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import mealIllustration from '@/stories/assets/meal-illustration-white.png'
import { createMeal } from '@/stories/fixtures'
import type { DemoMeal } from '@/lib/landing/load-demo-day'
import { DemoMealCard } from './DemoMealCard'

const entry: DemoMeal = {
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
}

const meta = {
  title: 'Landing/DemoMealCard',
  component: DemoMealCard,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "One of today's library meals on the planner card, as the landing page's deck draws it (`LandingDeck`). With `onOpen`, a click on the name, or anywhere else on the card, opens the meal; the deck opens the real cook view in `readOnly` mode. Without `onOpen` the card is a picture.",
      },
    },
  },
  args: { entry, onOpen: fn() },
} satisfies Meta<typeof DemoMealCard>

export default meta
type Story = StoryObj<typeof meta>

/** The name is the one button, and it opens the meal. */
export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('button')).toHaveLength(1)
    await userEvent.click(canvas.getByRole('button', { name: 'Beef bibimbap' }))
    await expect(args.onOpen).toHaveBeenCalledTimes(1)
  },
}

/**
 * A click anywhere on the card opens its meal, as on the planner card
 * (HON-1036): a pointer cursor, the name's focus ring drawn around the card.
 */
export const CardClickOpens: Story = {
  play: async ({ canvasElement, args }) => {
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
    await expect(args.onOpen).toHaveBeenCalledTimes(1)
  },
}

/**
 * Without `onOpen`: a picture, with no description, as the deck draws a card
 * when there is no demo day. The name is text, not a button, and the card has
 * no pointer cursor.
 */
export const PictureCard: Story = {
  args: { onOpen: undefined, description: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Beef bibimbap')).toBeInTheDocument()
    await expect(canvas.queryAllByRole('button')).toHaveLength(0)
    const card = canvasElement.querySelector<HTMLElement>('[data-slot="card"]')
    await expect(getComputedStyle(card!).cursor).not.toBe('pointer')
  },
}
