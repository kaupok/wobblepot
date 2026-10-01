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

// The 44px touch floor: the control lives in the cook view (docs/DESIGN.md →
// "Cook view", HON-932). Layout reports fractional pixels, so round to 0.01px
// before comparing.
const FLOOR_PX = 44
const px = (value: number) => Math.round(value * 100) / 100

const pencil = (root: HTMLElement) => root.querySelector('svg.lucide-pencil')

export const Default: Story = {
  args: {
    servings: 4,
    householdSize: 4,
  },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Serves 4. Click to edit.' })
    await expect(px(button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(FLOOR_PX)
    await expect(pencil(button)).toHaveAttribute('aria-hidden', 'true')
  },
}

export const Overridden: Story = {
  args: {
    servings: 6,
    householdSize: 4,
  },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Serves 6. Click to edit.' })
    await expect(px(button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(FLOOR_PX)
    await expect(button).toHaveTextContent('(custom)')
    await expect(pencil(button)).toBeInTheDocument()
  },
}

export const Editing: Story = {
  args: {
    servings: 4,
    householdSize: 4,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Serves 4. Click to edit.' }))
    const input = canvas.getByRole('textbox', { name: 'Number of servings' })
    await expect(input).toHaveFocus()
    await expect(pencil(canvasElement)).not.toBeInTheDocument()

    await userEvent.clear(input)
    await userEvent.type(input, '6{Enter}')
    await expect(args.onServingsChange).toHaveBeenCalledWith(6)
  },
}

export const Disabled: Story = {
  args: {
    servings: 4,
    householdSize: 4,
    disabled: true,
  },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Serves 4. Click to edit.' })
    await expect(button).toBeDisabled()
    await expect(pencil(canvasElement)).not.toBeInTheDocument()
  },
}
