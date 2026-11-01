import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, waitFor, within } from 'storybook/test'

import { expectBadgeRowOnOneLine } from '@/stories/layout-helpers'

import { ShowcaseMealCard } from './ShowcaseMealCard'

const meta = {
  title: 'Landing/ShowcaseMealCard',
  component: ShowcaseMealCard,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="flex max-w-md flex-col gap-3">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "One meal of the landing page's example day, drawn with `MealImageCard`, so the page shows the real card, tint and illustration rather than a screenshot. The deck shows the three when the library cannot fill a demo day. The images are committed copies under `public/landing/`; names and descriptions come from the `landing.showcase` catalog keys, so the day reads in the visitor's language.",
      },
    },
  },
  args: { meal: 'dinner' },
} satisfies Meta<typeof ShowcaseMealCard>

export default meta
type Story = StoryObj<typeof meta>

/** The dinner, tinted from its committed illustration's hue. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Baked salmon with asparagus')).toBeInTheDocument()
    await expect(canvasElement.querySelectorAll('[data-meal-surface]')).toHaveLength(1)
  },
}

/** All three meals of the example day. */
export const Day: Story = {
  render: () => (
    <>
      <ShowcaseMealCard meal="breakfast" />
      <ShowcaseMealCard meal="lunch" />
      <ShowcaseMealCard meal="dinner" />
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Avocado toast with poached egg')).toBeInTheDocument()
    await expect(canvas.getByText('Beef bibimbap')).toBeInTheDocument()
    await expect(canvasElement.querySelectorAll('[data-meal-surface]')).toHaveLength(3)
  },
}

/** `description={false}` drops the description, for a small picture. */
export const NoDescription: Story = {
  args: { meal: 'breakfast', description: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Avocado toast with poached egg')).toBeInTheDocument()
    await expect(canvas.queryByText(/Sourdough with smashed avocado/)).toBeNull()
  },
}

/**
 * The widest labels (lunch, beef) on a 300px card in Estonian (HON-1577): the
 * badges hold one line, and every label stays in the tree.
 */
export const Narrow: Story = {
  globals: { locale: 'et' },
  decorators: [
    (Story) => (
      <div className="w-75">
        <Story />
      </div>
    ),
  ],
  args: { meal: 'lunch' },
  play: async ({ canvasElement }) => {
    await waitFor(() => expectBadgeRowOnOneLine(canvasElement))
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Lõunasöök')).toBeInTheDocument()
    await expect(canvas.getByText('Lastesõbralik')).toBeInTheDocument()
    await expect(canvas.getByText('Veiseliha')).toBeInTheDocument()
  },
}

/**
 * A 224px card, narrower than the badges: the row overlaps them rather than
 * wrapping (`MealBadgeRow`, HON-1577), and the labels cut short.
 */
export const Overlapping: Story = {
  globals: { locale: 'et' },
  decorators: [
    (Story) => (
      <div className="w-56">
        <Story />
      </div>
    ),
  ],
  args: { meal: 'lunch' },
  play: async ({ canvasElement }) => {
    const row = await waitFor(() => expectBadgeRowOnOneLine(canvasElement))
    await waitFor(() => expect(row).toHaveAttribute('data-overlap'))
  },
}
