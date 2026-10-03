import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'
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
    // The label is for assistive tech only: the badge is no wider than a pill
    // around the icon.
    await expect(badge.getBoundingClientRect().width).toBeLessThan(48)
    // A mouse gets the label as the app's tooltip, not the browser's.
    await expect(badge).not.toHaveAttribute('title')
    await userEvent.hover(badge)
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent(
      'Kid-friendly',
    )
    await userEvent.unhover(badge)
  },
}

/**
 * The cook view's form (HON-1023): the icon pill at `lg`, with the `lg`
 * tooltip, so no text in the view is below 16px, and a 44px+ tap target.
 */
export const CompactLarge: Story = {
  args: { compact: true, size: 'lg' },
  play: async ({ canvasElement }) => {
    const badge = canvasElement.querySelector<HTMLElement>('[data-slot="badge"]')!
    // The `::after` hit area clears the cook view's 44px floor both ways.
    const box = badge.getBoundingClientRect()
    const after = getComputedStyle(badge, '::after')
    await expect(after.position).toBe('absolute')
    await expect(getComputedStyle(badge).overflow).toBe('visible')
    await expect(box.height - 2 * Number.parseFloat(after.top)).toBeGreaterThanOrEqual(44)
    await expect(box.width - 2 * Number.parseFloat(after.left)).toBeGreaterThanOrEqual(44)
    await userEvent.hover(badge)
    const tooltip = await within(document.body).findByRole('tooltip')
    await expect(tooltip).toHaveTextContent('Kid-friendly')
    const content = tooltip.closest<HTMLElement>('[data-slot="tooltip-content"]') ?? tooltip
    await expect(getComputedStyle(content).fontSize).toBe('16px')
    await userEvent.unhover(badge)
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
