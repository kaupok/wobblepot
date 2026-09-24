import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { Card, CardContent } from '@/components/ui/card'
import { KidFriendlyBadge } from './KidFriendlyBadge'
import { mealHueStyle } from './MealImageCard'
import { MealTypeBadge } from './MealTypeBadge'
import { ProteinBadge } from './ProteinBadge'

const meta = {
  title: 'Meal plan/KidFriendlyBadge',
  component: KidFriendlyBadge,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          "The one rendering of a meal's kid-friendly flag, shared by `MealCardBase`, `MealDetail` and `ImagineReviewDialog` (HON-764). A `secondary` badge with a `Baby` icon: on a tinted meal card `[data-meal-surface]` re-scopes `--secondary` to the meal's chip colour, so the same markup follows the tint. `compact` keeps the icon alone for a badge row (the recipe library card), with the label as the accessible name and tooltip.",
      },
    },
  },
} satisfies Meta<typeof KidFriendlyBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Neutral: Story = {
  play: async ({ canvasElement }) => {
    const badge = within(canvasElement).getByText('Kid-friendly')
    await expect(badge).toHaveAttribute('data-slot', 'badge')
  },
}

export const NeutralDark: Story = {
  globals: { theme: 'dark' },
}

/**
 * The icon alone, for the recipe library card's badge row. The label stays
 * the accessible name and the tooltip.
 */
export const Compact: Story = {
  args: { compact: true },
  play: async ({ canvasElement }) => {
    const badge = canvasElement.querySelector<HTMLElement>('[data-slot="badge"]')!
    await expect(badge).toHaveTextContent('Kid-friendly')
    await expect(badge).toHaveAttribute('title', 'Kid-friendly')
    // The label is for assistive tech only: the badge is no wider than a pill
    // around the icon.
    await expect(badge.getBoundingClientRect().width).toBeLessThan(48)
  },
}

/** Between the slot and protein badges, as on the recipe library card: the same height without any text of its own. */
export const CompactInBadgeRow: Story = {
  args: { compact: true },
  render: (args) => (
    <div className="flex items-center gap-1.5">
      <MealTypeBadge mealType="dinner" />
      <KidFriendlyBadge {...args} />
      <ProteinBadge proteinType="poultry" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const slot = canvas.getByText('Dinner').getBoundingClientRect()
    const kid = canvas.getByText('Kid-friendly').closest('[data-slot="badge"]')!
    await expect(kid.getBoundingClientRect().height).toBe(slot.height)
  },
}

/** Inside a tinted meal surface, the chip takes the meal's hue. */
function TintedSurface({ hue }: { hue: number }) {
  return (
    <Card data-meal-surface="" style={mealHueStyle(hue)}>
      <CardContent className="p-4">
        <KidFriendlyBadge />
      </CardContent>
    </Card>
  )
}

export const TintedSurfaceLight: Story = {
  render: () => (
    <div className="flex gap-3">
      <TintedSurface hue={52} />
      <TintedSurface hue={150} />
      <TintedSurface hue={280} />
    </div>
  ),
}

export const TintedSurfaceDark: Story = {
  ...TintedSurfaceLight,
  globals: { theme: 'dark' },
}
