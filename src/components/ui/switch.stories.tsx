import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Switch } from './switch'

const meta = {
  title: 'UI/Switch',
  component: Switch,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { 'aria-label': 'Have it: Milk', onCheckedChange: fn() },
} satisfies Meta<typeof Switch>

export default meta
type Story = StoryObj<typeof meta>

/** Uncontrolled: a click flips `aria-checked` and reports the next state. */
export const Off: Story = {
  play: async ({ args, canvasElement }) => {
    const control = within(canvasElement).getByRole('switch')
    await expect(control).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(control)
    await expect(control).toHaveAttribute('aria-checked', 'true')
    await expect(args.onCheckedChange).toHaveBeenCalledWith(true)
  },
}

export const On: Story = {
  args: { defaultChecked: true },
}

export const Disabled: Story = {
  args: { disabled: true },
}

export const DisabledOn: Story = {
  args: { disabled: true, defaultChecked: true },
}

/** An 18px track whose `::after` hit area reaches the 44px touch target. */
export const TouchTarget: Story = {
  play: async ({ canvasElement }) => {
    const control = within(canvasElement).getByRole('switch')
    await expect(control.getBoundingClientRect().height).toBe(18)
    await expect(control.getBoundingClientRect().width).toBe(32)
    await expect(Number.parseFloat(getComputedStyle(control, '::after').height)).toBe(44)
  },
}
