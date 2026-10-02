import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { LandingShowcase } from './LandingShowcase'

const meta = {
  title: 'Landing/LandingShowcase',
  component: LandingShowcase,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "The example day on the signed-out landing page: three planner cards (breakfast, lunch, dinner) drawn with `MealImageCard`, so the page shows the real card, tint and illustration rather than a screenshot. The images are committed copies under `public/landing/`; names and descriptions come from the `landing.showcase` catalog keys, so the day reads in the visitor's language.",
      },
    },
  },
} satisfies Meta<typeof LandingShowcase>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('figure')).toBeInTheDocument()
    await expect(canvas.getByText('Avocado toast with poached egg')).toBeInTheDocument()
    await expect(canvas.getByText('Beef bibimbap')).toBeInTheDocument()
    await expect(canvas.getByText('Baked salmon with asparagus')).toBeInTheDocument()
    // Every card carries its tint from the committed illustration's hue.
    await expect(canvasElement.querySelectorAll('[data-meal-surface]')).toHaveLength(3)
  },
}

/** Narrow column: the image box drops to 45% and the description hides. */
export const Narrow: Story = {
  render: () => (
    <div className="max-w-sm">
      <LandingShowcase />
    </div>
  ),
}
