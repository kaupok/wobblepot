import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import { StatusSelect } from './StatusSelect'

const meta = {
  title: 'Meal plan/StatusSelect',
  component: StatusSelect,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: {
    onChange: fn(),
  },
} satisfies Meta<typeof StatusSelect>

export default meta
type Story = StoryObj<typeof meta>

export const Planned: Story = {
  args: { value: 'planned' },
}

export const Completed: Story = {
  args: { value: 'completed' },
}

export const Skipped: Story = {
  args: { value: 'skipped' },
}

export const Disabled: Story = {
  args: { value: 'planned', disabled: true },
}
