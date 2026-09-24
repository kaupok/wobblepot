import type { CSSProperties } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { AvailabilityIndicator } from './AvailabilityIndicator'
import { MealTypeBadge } from './MealTypeBadge'
import { ProteinBadge } from './ProteinBadge'

const meta = {
  title: 'Meal plan/AvailabilityIndicator',
  component: AvailabilityIndicator,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'The pantry\'s verdict on a meal card, as a `surface` `Badge`: the same pill as the slot and protein badges above it, on the page background rather than the meal\'s chip colour. Green "Have all ingredients" when the meal is ready to cook, otherwise amber "{n} ingredients missing". `missingIngredients` is accepted on the `MealAvailability` shape but not rendered by this component — the detailed list appears elsewhere.',
      },
    },
  },
} satisfies Meta<typeof AvailabilityIndicator>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {
  args: {
    availability: { isReady: true, missingCount: 0, missingIngredients: [] },
  },
}

export const OneMissing: Story = {
  args: {
    availability: {
      isReady: false,
      missingCount: 1,
      missingIngredients: ['Chicken thigh'],
    },
  },
}

export const MultipleMissing: Story = {
  args: {
    availability: {
      isReady: false,
      missingCount: 3,
      missingIngredients: ['Chicken thigh', 'Potato', 'Lemon'],
    },
  },
}

/**
 * Below the slot and protein badges on a tinted planner card: the same pill
 * size, on the page background, with no ring (the tint scope drops it).
 */
export const OnTintedSurface: Story = {
  args: {
    availability: {
      isReady: false,
      missingCount: 3,
      missingIngredients: ['Chicken thigh', 'Potato', 'Lemon'],
    },
  },
  render: (args) => (
    // `--meal-hue` is the one per-meal value (docs/DESIGN.md → Imagery); the
    // surface derives every colour from it.
    <div
      data-meal-surface=""
      style={{ '--meal-hue': 52 } as CSSProperties}
      className="flex w-64 flex-col gap-2 rounded-xl p-4"
    >
      <div className="flex items-center gap-1.5">
        <MealTypeBadge mealType="dinner" />
        <ProteinBadge proteinType="poultry" />
      </div>
      <div>
        <AvailabilityIndicator {...args} />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const badge = canvas.getByText('3 ingredients missing')
    const slot = canvas.getByText('Dinner')
    await expect(badge.getBoundingClientRect().height).toBe(slot.getBoundingClientRect().height)
    await expect(getComputedStyle(badge).borderTopColor).toBe('rgba(0, 0, 0, 0)')
  },
}

export const OnTintedSurfaceReady: Story = {
  ...OnTintedSurface,
  args: {
    availability: { isReady: true, missingCount: 0, missingIngredients: [] },
  },
  play: async ({ canvasElement }) => {
    const badge = within(canvasElement).getByText('Have all ingredients')
    await expect(getComputedStyle(badge).borderTopColor).toBe('rgba(0, 0, 0, 0)')
  },
}
