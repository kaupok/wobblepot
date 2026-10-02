import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { Card, CardContent } from '@/components/ui/card'
import { mealHueStyle } from './MealImageCard'
import { MealTypeBadge } from './MealTypeBadge'
import { MyRecipeBadge } from './MyRecipeBadge'
import { ProteinBadge } from './ProteinBadge'

const meta = {
  title: 'Meal plan/MyRecipeBadge',
  component: MyRecipeBadge,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          "Marks one of the household's own recipes among library meals, on the planner card and the meal selector's cards (HON-948). A `secondary` badge with the `BookOpen` icon the header and tab bar use for My recipes: on a tinted meal card `[data-meal-surface]` re-scopes `--secondary` to the meal's chip colour. `compact` keeps the icon alone for a badge row, with the label as the accessible name and tooltip.",
      },
    },
  },
} satisfies Meta<typeof MyRecipeBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Labelled: Story = {
  play: async ({ canvasElement }) => {
    const badge = within(canvasElement).getByText('My recipe')
    await expect(badge).toHaveAttribute('data-slot', 'badge')
    await expect(badge).not.toHaveAttribute('title')
  },
}

export const LabelledDark: Story = {
  globals: { theme: 'dark' },
}

/**
 * The icon alone, as on the planner and selector cards. The label stays the
 * accessible name and the tooltip.
 */
export const Compact: Story = {
  args: { compact: true },
  play: async ({ canvasElement }) => {
    const badge = canvasElement.querySelector<HTMLElement>('[data-slot="badge"]')!
    await expect(badge).toHaveTextContent('My recipe')
    await expect(badge).toHaveAttribute('title', 'My recipe')
    await expect(within(canvasElement).getByText('My recipe')).toHaveClass('sr-only')
    // The label is for assistive tech only: the badge is no wider than a pill
    // around the icon.
    await expect(badge.getBoundingClientRect().width).toBeLessThan(48)
  },
}

/** `lg`, the cook view's size (HON-932), labelled and compact. */
export const Large: Story = {
  args: { size: 'lg' },
  render: (args) => (
    <div className="flex items-center gap-1.5">
      <MyRecipeBadge {...args} />
      <MyRecipeBadge {...args} compact />
    </div>
  ),
}

/** After the slot and protein badges, as on the planner card: the same height without any text of its own. */
export const CompactInBadgeRow: Story = {
  args: { compact: true },
  render: (args) => (
    <div className="flex items-center gap-1.5">
      <MealTypeBadge mealType="dinner" />
      <ProteinBadge proteinType="poultry" />
      <MyRecipeBadge {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const slot = canvas.getByText('Dinner').getBoundingClientRect()
    const own = canvas.getByText('My recipe').closest('[data-slot="badge"]')!
    await expect(own.getBoundingClientRect().height).toBe(slot.height)
  },
}

/** Inside a tinted meal surface, the chip takes the meal's hue. */
function TintedSurface({ hue }: { hue: number }) {
  return (
    <Card data-meal-surface="" style={mealHueStyle(hue)}>
      <CardContent className="flex items-center gap-1.5 p-4">
        <ProteinBadge proteinType="poultry" />
        <MyRecipeBadge compact />
        <MyRecipeBadge />
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
