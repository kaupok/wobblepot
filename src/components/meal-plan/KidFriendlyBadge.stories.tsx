import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { Card, CardContent } from '@/components/ui/card'
import { KidFriendlyBadge } from './KidFriendlyBadge'
import { mealHueStyle } from './MealImageCard'

const meta = {
  title: 'Meal plan/KidFriendlyBadge',
  component: KidFriendlyBadge,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          "The one rendering of a meal's kid-friendly flag, shared by `MealCardBase`, `MealDetail` and `ImagineReviewDialog` (HON-764). A `secondary` badge with a `Baby` icon: on a tinted meal card `[data-meal-surface]` re-scopes `--secondary` to the meal's chip colour, so the same markup follows the tint.",
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
