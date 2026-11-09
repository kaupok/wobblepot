import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ToggleGroup, ToggleGroupItem } from './toggle-group'

const meta = {
  title: 'UI/ToggleGroup',
  component: ToggleGroup,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A row of `Toggle` parts with one outline, a segmented control. It takes `Toggle`\'s `variant`, `tone`, `size` and `indicator` and hands them to each part. `type="single"` makes the group a `radiogroup` and gives each part `role="radio"` with `aria-checked`, and the arrow keys move between the parts.',
      },
    },
  },
  args: {
    type: 'single',
    variant: 'outline',
    tone: 'primary',
    size: 'sm-touch',
    indicator: true,
    defaultValue: 'week',
    'aria-label': 'Range',
    onValueChange: fn(),
  },
  render: (args) => (
    <ToggleGroup {...args}>
      <ToggleGroupItem value="day">Day</ToggleGroupItem>
      <ToggleGroupItem value="week">Week</ToggleGroupItem>
      <ToggleGroupItem value="month">Month</ToggleGroupItem>
    </ToggleGroup>
  ),
} satisfies Meta<typeof ToggleGroup>

export default meta
type Story = StoryObj<typeof meta>

/** One pressed part; a press on another moves the check and `aria-checked` to it. */
export const Single: Story = {
  play: async ({ canvasElement, args }) => {
    const group = within(canvasElement).getByRole('radiogroup', { name: 'Range' })
    const week = within(group).getByRole('radio', { name: 'Week' })
    await expect(week).toHaveAttribute('aria-checked', 'true')
    const month = within(group).getByRole('radio', { name: 'Month' })
    await userEvent.click(month)
    await expect(month).toHaveAttribute('aria-checked', 'true')
    await expect(week).toHaveAttribute('aria-checked', 'false')
    await expect(args.onValueChange).toHaveBeenCalledWith('month')
    // Arrow keys move focus between the parts.
    await userEvent.keyboard('{ArrowLeft}')
    await expect(week).toHaveFocus()
  },
}

export const DefaultSize: Story = {
  args: { size: 'default' },
}

export const NoIndicator: Story = {
  args: { indicator: false, tone: 'default' },
}
