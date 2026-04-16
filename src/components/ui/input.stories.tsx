import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Input } from './input'
import { Label } from './label'

const meta = {
  title: 'UI/Input',
  component: Input,
  tags: ['autodocs'],
  argTypes: {
    type: {
      control: 'select',
      options: ['text', 'email', 'password', 'number', 'search'],
    },
    disabled: { control: 'boolean' },
  },
  args: {
    placeholder: 'Type here…',
  },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <div className="w-72">
      <Input {...args} />
    </div>
  ),
}

export const Disabled: Story = {
  args: { disabled: true, defaultValue: 'Disabled value' },
  render: (args) => (
    <div className="w-72">
      <Input {...args} />
    </div>
  ),
}

export const WithValue: Story = {
  args: { defaultValue: 'Lemon-garlic chicken' },
  render: (args) => (
    <div className="w-72">
      <Input {...args} />
    </div>
  ),
}

export const Invalid: Story = {
  args: { 'aria-invalid': true, defaultValue: 'invalid@' },
  render: (args) => (
    <div className="w-72">
      <Input {...args} />
    </div>
  ),
}

export const Email: Story = {
  args: { type: 'email', placeholder: 'you@example.com' },
  render: (args) => (
    <div className="w-72">
      <Input {...args} />
    </div>
  ),
}

export const Password: Story = {
  args: { type: 'password', defaultValue: 'hunter2' },
  render: (args) => (
    <div className="w-72">
      <Input {...args} />
    </div>
  ),
}

export const WithLabel: Story = {
  render: () => (
    <div className="grid w-72 gap-2">
      <Label htmlFor="meal-name">Meal name</Label>
      <Input id="meal-name" placeholder="e.g. Lemon-garlic chicken" />
    </div>
  ),
}
