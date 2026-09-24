import type { CSSProperties } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { CheckIcon, Clock } from 'lucide-react'
import { expect, within } from 'storybook/test'
import { Badge } from './badge'

const meta = {
  title: 'UI/Badge',
  component: Badge,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'default',
        'secondary',
        'destructive',
        'outline',
        'warning',
        'info',
        'surface',
        'surface-success',
        'surface-warning',
      ],
    },
  },
  args: {
    children: 'Badge',
  },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Secondary: Story = {
  args: { variant: 'secondary' },
}

export const Destructive: Story = {
  args: { variant: 'destructive' },
}

export const Outline: Story = {
  args: { variant: 'outline' },
}

export const StatusWarning: Story = {
  args: { variant: 'warning', children: 'Low confidence' },
}

export const StatusInfo: Story = {
  args: { variant: 'info', children: 'Estimated' },
}

/** The page background as a pill. On the neutral card the `--border` ring is what makes it one. */
export const Surface: Story = {
  args: {
    variant: 'surface',
    children: (
      <>
        <Clock />
        30 min
      </>
    ),
  },
}

export const SurfaceSuccess: Story = {
  args: { variant: 'surface-success', children: 'Have all ingredients' },
}

export const SurfaceWarning: Story = {
  args: { variant: 'surface-warning', children: '3 ingredients missing' },
}

/**
 * On a tinted meal surface the surface badges are white pills on the colour,
 * and the tint scope drops their ring (`[data-variant^='surface']` in
 * globals.css). The chip-coloured `secondary` and `outline` badges beside them
 * are the meal's own.
 */
export const SurfaceOnTintedSurface: Story = {
  render: () => (
    // `--meal-hue` is the one per-meal value (docs/DESIGN.md → Imagery); the
    // surface derives every colour from it.
    <div
      data-meal-surface=""
      style={{ '--meal-hue': 52 } as CSSProperties}
      className="flex flex-wrap items-center gap-1.5 rounded-xl p-4"
    >
      <Badge variant="secondary">Dinner</Badge>
      <Badge variant="outline">Poultry</Badge>
      <Badge variant="surface">
        <Clock />
        30 min
      </Badge>
      <Badge variant="surface-success">Have all ingredients</Badge>
      <Badge variant="surface-warning">3 ingredients missing</Badge>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const text of ['30 min', 'Have all ingredients', '3 ingredients missing']) {
      const badge = canvas.getByText(text)
      await expect(badge).toHaveAttribute('data-variant', expect.stringMatching(/^surface/))
      await expect(getComputedStyle(badge).borderTopColor).toBe('rgba(0, 0, 0, 0)')
    }
    // The meal's own badges keep their ring in the chip colour.
    await expect(getComputedStyle(canvas.getByText('Poultry')).borderTopColor).not.toBe(
      'rgba(0, 0, 0, 0)',
    )
  },
}

export const SurfaceOnTintedSurfaceDark: Story = {
  ...SurfaceOnTintedSurface,
  globals: { theme: 'dark' },
}

export const WithIcon: Story = {
  args: {
    children: (
      <>
        <CheckIcon />
        Done
      </>
    ),
  },
}

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Badge>Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="warning">Warning</Badge>
      <Badge variant="info">Info</Badge>
      <Badge variant="surface">Surface</Badge>
      <Badge variant="surface-success">Surface success</Badge>
      <Badge variant="surface-warning">Surface warning</Badge>
    </div>
  ),
}
