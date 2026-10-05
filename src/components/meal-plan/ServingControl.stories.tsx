import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { ServingControl } from './ServingControl'

const meta = {
  title: 'Meal plan/ServingControl',
  component: ServingControl,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: {
    onServingsChange: fn(async () => true),
  },
} satisfies Meta<typeof ServingControl>

export default meta
type Story = StoryObj<typeof meta>

// The cook view's badge row (HON-1025): the control is a `surface` `lg` badge,
// as tall as the time badge beside it, and its `::after` reaches past the pill
// so the target clears the 44px touch floor (docs/DESIGN.md → "Cook view").
// Layout reports fractional pixels, so round to 0.01px before comparing.
const FLOOR_PX = 44
const BADGE_PX = 34
const px = (value: number) => Math.round(value * 100) / 100

const pencil = (root: HTMLElement) => root.querySelector('svg.lucide-pencil')

/** The badge's height, and the height of its `::after` tap target. */
function measure(badge: HTMLElement): { height: number; target: number } {
  const height = badge.getBoundingClientRect().height
  const after = getComputedStyle(badge, '::after')
  return { height: px(height), target: px(height - 2 * Number.parseFloat(after.top)) }
}

export const Default: Story = {
  args: {
    servings: 4,
    householdServings: 4,
  },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Serves 4. Click to edit.' })
    await expect(button).toHaveAttribute('data-slot', 'badge')
    await expect(button).toHaveAttribute('data-variant', 'surface')
    const { height, target } = measure(button)
    await expect(height).toBe(BADGE_PX)
    await expect(target).toBeGreaterThanOrEqual(FLOOR_PX)
    await expect(pencil(button)).toHaveAttribute('aria-hidden', 'true')
    // A pointer says it is an action, unlike the time pill beside it (HON-1032).
    await expect(getComputedStyle(button).cursor).toBe('pointer')
  },
}

export const Overridden: Story = {
  args: {
    servings: 6,
    householdServings: 4,
  },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Serves 6. Click to edit.' })
    await expect(measure(button).height).toBe(BADGE_PX)
    // "(custom)" in the info tone, inside the badge.
    const custom = within(button).getByText('(custom)')
    await expect(custom.closest('.text-info')).not.toBeNull()
    await expect(pencil(button)).toBeInTheDocument()
  },
}

// Two adults and a toddler at 0.5×: the household cooks for 2.5 servings, so
// the badge shows the fraction, and a typed whole number is an override
// (HON-1040).
export const FractionalHouseholdServings: Story = {
  args: {
    servings: 2.5,
    householdServings: 2.5,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: 'Serves 2.5. Click to edit.' })
    await expect(button).toHaveTextContent(/^Serves 2\.5$/)
    await userEvent.click(button)
    const input = canvas.getByRole('textbox', { name: 'Number of servings' })
    await userEvent.clear(input)
    await userEvent.type(input, '3{Enter}')
    await expect(args.onServingsChange).toHaveBeenCalledWith(3)
  },
}

export const Editing: Story = {
  args: {
    servings: 4,
    householdServings: 4,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Serves 4. Click to edit.' }))
    const input = canvas.getByRole('textbox', { name: 'Number of servings' })
    await expect(input).toHaveFocus()
    await expect(pencil(canvasElement)).not.toBeInTheDocument()
    // The field opens inside a badge of the same height, so the row holds still.
    const badge = input.closest<HTMLElement>('[data-slot="badge"]')!
    await expect(measure(badge).height).toBe(BADGE_PX)
    // 16px, so iOS does not zoom in on focus.
    await expect(getComputedStyle(input).fontSize).toBe('16px')

    await userEvent.clear(input)
    await userEvent.type(input, '6{Enter}')
    await expect(args.onServingsChange).toHaveBeenCalledWith(6)
  },
}

export const EditingEscape: Story = {
  name: 'Editing, Escape cancels',
  args: {
    servings: 4,
    householdServings: 4,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Serves 4. Click to edit.' }))
    await userEvent.type(canvas.getByRole('textbox', { name: 'Number of servings' }), '9')
    await userEvent.keyboard('{Escape}')
    await expect(canvas.getByRole('button', { name: 'Serves 4. Click to edit.' })).toBeVisible()
    await expect(args.onServingsChange).not.toHaveBeenCalled()
  },
}

export const Disabled: Story = {
  args: {
    servings: 4,
    householdServings: 4,
    disabled: true,
  },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Serves 4. Click to edit.' })
    await expect(button).toBeDisabled()
    await expect(pencil(canvasElement)).not.toBeInTheDocument()
    // No pointer while it cannot be used, as while a change is saving (HON-1032).
    await expect(getComputedStyle(button).cursor).toBe('default')
  },
}
