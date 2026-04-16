import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
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

export const Default: Story = {
  args: {
    servings: 4,
    householdSize: 4,
  },
}

export const Overridden: Story = {
  args: {
    servings: 6,
    householdSize: 4,
  },
}

export const Disabled: Story = {
  args: {
    servings: 4,
    householdSize: 4,
    disabled: true,
  },
}
