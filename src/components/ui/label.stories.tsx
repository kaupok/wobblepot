import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Checkbox } from './checkbox'
import { Input } from './input'
import { Label } from './label'

const meta = {
  title: 'UI/Label',
  component: Label,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: {
    children: 'Label',
  },
} satisfies Meta<typeof Label>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithInput: Story = {
  render: () => (
    <div className="grid w-72 gap-2">
      <Label htmlFor="email">Email</Label>
      <Input id="email" type="email" placeholder="you@example.com" />
    </div>
  ),
}

export const WithCheckbox: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="kid-friendly" />
      <Label htmlFor="kid-friendly">Kid-friendly</Label>
    </div>
  ),
}

export const Disabled: Story = {
  render: () => (
    <div className="group grid w-72 gap-2" data-disabled="true">
      <Label htmlFor="disabled-input">Disabled label</Label>
      <Input id="disabled-input" disabled defaultValue="Read-only" />
    </div>
  ),
}
