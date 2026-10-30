import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'

import { PortionNutrition } from './PortionNutrition'

const TROUT = { calories: 520, protein: 38, carbs: 30, fat: 22 }

const meta = {
  title: 'Meal plan/PortionNutrition',
  component: PortionNutrition,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'The cook view’s nutrition, per serving or for one member’s plate (HON-1475). A chip per member multiplies the per-serving values by their portion; the view opens on the signed-in member’s chip when their portion is not 1×. With every member at 1×, or no members, there are no chips.',
      },
    },
  },
  args: { nutrition: TROUT, size: 'lg' },
  decorators: [
    (Story) => (
      // The cook view's nutrition column on a phone.
      <div className="w-87.5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PortionNutrition>

export default meta
type Story = StoryObj<typeof meta>

/** Two adults and a toddler; the signed-in adult eats 1.5×, so the view opens on their chip. */
export const Members: Story = {
  args: {
    portions: [
      { id: 'm1', name: 'Kaupo', multiplier: 1.5, isSelf: true },
      { id: 'm2', name: 'Mari', multiplier: 1, isSelf: false },
      { id: 'm3', name: 'Nora', multiplier: 0.5, isSelf: false },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('radio', { name: 'Kaupo 1.5×' })).toBeChecked()
    await expect(canvas.getByText('57g')).toBeVisible()
    await expect(canvas.getByText('Kaupo, 1.5× portion')).toBeVisible()

    // The 44px touch floor on a phone, the default story viewport.
    for (const chip of canvas.getAllByRole('radio')) {
      await expect(chip.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }

    await userEvent.click(canvas.getByRole('radio', { name: 'Nora 0.5×' }))
    await expect(canvas.getByText('19g')).toBeVisible()

    await userEvent.click(canvas.getByRole('radio', { name: 'Per serving' }))
    await expect(canvas.getByText('38g')).toBeVisible()
    await expect(canvas.getByText('per serving')).toBeVisible()
  },
}

/** Every member at 1×: each chip would repeat "Per serving", so there are none. */
export const AllOneTimes: Story = {
  name: 'All at 1× (no chips)',
  args: {
    portions: [
      { id: 'm1', name: 'Kaupo', multiplier: 1, isSelf: true },
      { id: 'm2', name: 'Mari', multiplier: 1, isSelf: false },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('radiogroup')).not.toBeInTheDocument()
    await expect(canvas.getByText('per serving')).toBeVisible()
  },
}

/** No household (the landing deck), or the members are loading or failed. */
export const NoMembers: Story = {
  name: 'No members',
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('radiogroup')).not.toBeInTheDocument()
  },
}
