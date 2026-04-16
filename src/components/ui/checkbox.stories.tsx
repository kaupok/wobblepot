import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Checkbox } from './checkbox'
import { Label } from './label'

const meta = {
  title: 'UI/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Checkbox>

export default meta
type Story = StoryObj<typeof meta>

export const Unchecked: Story = {}

export const Checked: Story = {
  args: { defaultChecked: true },
}

export const Indeterminate: Story = {
  args: { checked: 'indeterminate' },
}

export const Disabled: Story = {
  args: { disabled: true },
}

export const DisabledChecked: Story = {
  args: { disabled: true, defaultChecked: true },
}

export const WithLabel: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="kid-friendly" defaultChecked />
      <Label htmlFor="kid-friendly">Kid-friendly</Label>
    </div>
  ),
}

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Checkbox id="state-unchecked" />
        <Label htmlFor="state-unchecked">Unchecked</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="state-checked" defaultChecked />
        <Label htmlFor="state-checked">Checked</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="state-indeterminate" checked="indeterminate" />
        <Label htmlFor="state-indeterminate">Indeterminate</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="state-disabled" disabled />
        <Label htmlFor="state-disabled">Disabled</Label>
      </div>
    </div>
  ),
}
