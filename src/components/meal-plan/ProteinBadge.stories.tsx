import type { CSSProperties } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { ProteinType } from '@/generated/prisma/enums'
import { MealTypeBadge } from './MealTypeBadge'
import { ProteinBadge } from './ProteinBadge'

const meta = {
  title: 'Meal plan/ProteinBadge',
  component: ProteinBadge,
  tags: ['autodocs'],
  args: { proteinType: ProteinType.poultry },
} satisfies Meta<typeof ProteinBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Poultry: Story = {}

export const Fish: Story = { args: { proteinType: ProteinType.fish } }

/** `none` renders nothing: a meal without a primary protein has no badge to wear. */
export const None: Story = {
  args: { proteinType: ProteinType.none },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-slot="badge"]')).toBeNull()
  },
}

/** Beside the slot badge, as on a planner card: filled slot, outline protein. */
export const BesideSlotBadge: Story = {
  render: (args) => (
    <div className="flex items-center gap-1.5">
      <MealTypeBadge mealType="dinner" />
      <ProteinBadge {...args} />
    </div>
  ),
}

/** On a tinted meal surface the outline badge takes the meal's text colour. */
export const OnTintedSurface: Story = {
  render: (args) => (
    // `--meal-hue` is the one per-meal value (docs/DESIGN.md → Imagery); the
    // surface derives every colour from it.
    <div data-meal-surface="" style={{ '--meal-hue': 52 } as CSSProperties} className="p-4">
      <div className="flex items-center gap-1.5">
        <MealTypeBadge mealType="dinner" />
        <ProteinBadge {...args} />
      </div>
    </div>
  ),
}

export const AllTypes: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {Object.values(ProteinType).map((type) => (
        <ProteinBadge key={type} proteinType={type} />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    // Eight named proteins; `none` is the ninth value and renders nothing.
    await expect(within(canvasElement).getAllByText(/./).length).toBe(8)
  },
}
