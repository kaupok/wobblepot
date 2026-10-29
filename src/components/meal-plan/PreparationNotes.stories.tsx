import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'

import { mealHueStyle } from './MealImageCard'
import { PreparationNotes } from './PreparationNotes'

const meta = {
  title: 'Meal plan/PreparationNotes',
  component: PreparationNotes,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The household’s own notes in the cook view’s steps area, after the generated steps, closed under “Your notes” until the cook opens them (HON-1259). The text keeps its line breaks.',
      },
    },
  },
  args: {
    notes:
      '1. Sear the chicken at 220°C for 3 minutes.\n2. Roast at 180°C for 20 minutes.\n3. Rest for 5 minutes.\n\nThe kids like ketchup on the side.',
  },
  decorators: [
    // On a meal tint, as in the cook view.
    (Story) => (
      <div data-meal-surface="" style={mealHueStyle(52)} className="max-w-xl p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PreparationNotes>

export default meta
type Story = StoryObj<typeof meta>

export const Collapsed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'Your notes' })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.getByRole('heading', { level: 3, name: 'Your notes' })).toBeVisible()
    await expect(canvas.queryByText(/Sear the chicken/)).toBeNull()
    // A cook view row: at least the 44px floor (docs/DESIGN.md → cook view).
    await expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  },
}

export const Expanded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'Your notes' })
    await userEvent.click(trigger)
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const notes = canvas.getByText(/Sear the chicken/)
    await expect(notes).toBeVisible()
    // Each line of the notes on its own line, as the household wrote them.
    await expect(getComputedStyle(notes).whiteSpace).toBe('pre-line')
  },
}

export const ExpandedDark: Story = {
  ...Expanded,
  globals: { theme: 'dark' },
}
