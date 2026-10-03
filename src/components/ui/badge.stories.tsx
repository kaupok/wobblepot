import type { CSSProperties } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { CheckIcon, Clock, Pencil } from 'lucide-react'
import { expect, userEvent, within } from 'storybook/test'
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
    hitArea: { control: 'select', options: ['default', 'touch'] },
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
  args: { variant: 'surface-warning', children: '3 ingredients to buy' },
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
      <Badge variant="surface-warning">3 ingredients to buy</Badge>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const text of ['30 min', 'Have all ingredients', '3 ingredients to buy']) {
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

/**
 * A surface badge that is a button, the cook view's Serves (HON-1032): a
 * pointer and the `ghost` Button's accent hover while it is enabled, neither
 * while it is disabled. The time badge beside it is a span and keeps the
 * default cursor. A synthetic hover does not reach CSS `:hover`, so the hover
 * classes are asserted in badge.test.tsx and the hover look is measured by axe
 * in `SurfaceButtonHoverLook`.
 */
function SurfaceButtonRow({ surface }: { surface: 'tinted' | 'neutral' }) {
  return (
    <div
      {...(surface === 'tinted' ? { 'data-meal-surface': '' } : {})}
      style={surface === 'tinted' ? ({ '--meal-hue': 52 } as CSSProperties) : undefined}
      className="bg-card flex flex-wrap items-center gap-1.5 rounded-xl border p-4"
    >
      <Badge variant="surface" size="lg">
        <Clock />
        30 min
      </Badge>
      <Badge asChild variant="surface" size="lg" hitArea="touch">
        <button type="button">
          Serves 4
          <Pencil aria-hidden="true" />
        </button>
      </Badge>
      <Badge asChild variant="surface" size="lg" hitArea="touch">
        <button type="button" disabled>
          Serves 2
        </button>
      </Badge>
    </div>
  )
}

const surfaceButtonPlay: Story['play'] = async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  const enabled = canvas.getByRole('button', { name: 'Serves 4' })
  const disabled = canvas.getByRole('button', { name: 'Serves 2' })
  await expect(getComputedStyle(enabled).cursor).toBe('pointer')
  await expect(getComputedStyle(disabled).cursor).toBe('default')
  await expect(getComputedStyle(canvas.getByText('30 min')).cursor).toBe('auto')
  await expect(getComputedStyle(enabled).transitionProperty).toContain('background-color')
  // Keyboard focus still draws the ring.
  await userEvent.tab()
  await expect(enabled).toHaveFocus()
  await expect(getComputedStyle(enabled).boxShadow).not.toBe('none')
}

export const SurfaceButtonOnTintedSurface: Story = {
  render: () => <SurfaceButtonRow surface="tinted" />,
  play: surfaceButtonPlay,
}

export const SurfaceButtonOnTintedSurfaceDark: Story = {
  ...SurfaceButtonOnTintedSurface,
  globals: { theme: 'dark' },
}

export const SurfaceButtonOnNeutralCard: Story = {
  render: () => <SurfaceButtonRow surface="neutral" />,
  play: surfaceButtonPlay,
}

export const SurfaceButtonOnNeutralCardDark: Story = {
  ...SurfaceButtonOnNeutralCard,
  globals: { theme: 'dark' },
}

/**
 * The hover look drawn at rest, so axe measures it: axe cannot see `:hover`.
 * The overridden Serves count keeps its `text-info` span on the accent, which
 * is the pairing this checks, on a tint and on the neutral card.
 */
function HoverLookRow() {
  const hover = 'bg-accent text-accent-foreground dark:bg-accent/50'
  return (
    <div className="flex flex-col gap-3">
      <div
        data-meal-surface=""
        style={{ '--meal-hue': 52 } as CSSProperties}
        className="flex items-center gap-1.5 rounded-xl p-4"
      >
        <Badge variant="surface" size="lg" className={hover}>
          Serves 4
        </Badge>
        <Badge variant="surface" size="lg" className={hover}>
          <span className="text-info">Serves 6 (custom)</span>
        </Badge>
      </div>
      <div className="bg-card flex items-center gap-1.5 rounded-xl border p-4">
        <Badge variant="surface" size="lg" className={hover}>
          Serves 4
        </Badge>
        <Badge variant="surface" size="lg" className={hover}>
          <span className="text-info">Serves 6 (custom)</span>
        </Badge>
      </div>
    </div>
  )
}

export const SurfaceButtonHoverLook: Story = {
  render: () => <HoverLookRow />,
}

export const SurfaceButtonHoverLookDark: Story = {
  render: () => <HoverLookRow />,
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

// The cook view (HON-932): 16px text, so nothing in it but the nutrition fine
// print drops below 16px.
export const Large: Story = {
  args: { size: 'lg', variant: 'secondary', children: 'Kid-friendly' },
  play: async ({ canvasElement }) => {
    const badge = within(canvasElement).getByText('Kid-friendly')
    await expect(getComputedStyle(badge).fontSize).toBe('16px')
  },
}

// A badge that is a tap target (the cook view's Kid-friendly pill, HON-1023):
// the `::after` makes the target 44px or more without changing the pill.
export const TouchHitArea: Story = {
  args: { size: 'lg', variant: 'secondary', hitArea: 'touch', children: 'Kid-friendly' },
  play: async ({ canvasElement }) => {
    const badge = within(canvasElement).getByText('Kid-friendly')
    const box = badge.getBoundingClientRect()
    const after = getComputedStyle(badge, '::after')
    await expect(after.position).toBe('absolute')
    await expect(after.top).toBe('-8px')
    await expect(after.left).toBe('-4px')
    await expect(box.height + 16).toBeGreaterThanOrEqual(44)
    await expect(getComputedStyle(badge).overflow).toBe('visible')
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
