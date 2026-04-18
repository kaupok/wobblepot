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

export const Focused: Story = {
  args: { autoFocus: true, defaultValue: 'Focused input' },
  render: (args) => (
    <div className="w-72">
      <Label htmlFor="focused-input" className="mb-2">
        Focused (autoFocus)
      </Label>
      <Input id="focused-input" {...args} />
    </div>
  ),
}

// WHY: Disabled inputs render at 50% opacity, dipping below 4.5:1 on the
// placeholder / value. WCAG 1.4.3 exempts inactive UI components from the
// contrast rule — axe can't infer the disabled state from opacity, so waive
// only `color-contrast`. Focused state is covered by the separate `Focused`
// story to avoid autoFocus stealing focus on grid render.
export const AllVariants: Story = {
  parameters: {
    a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } },
  },
  render: () => (
    <div className="flex w-72 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="av-default">Default</Label>
        <Input id="av-default" placeholder="Type here…" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="av-value">With value</Label>
        <Input id="av-value" defaultValue="Lemon-garlic chicken" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="av-disabled">Disabled</Label>
        <Input id="av-disabled" disabled defaultValue="Disabled value" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="av-readonly">Read-only</Label>
        <Input id="av-readonly" readOnly defaultValue="Read-only value" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="av-invalid">Invalid (aria-invalid)</Label>
        <Input id="av-invalid" aria-invalid defaultValue="invalid@" />
      </div>
    </div>
  ),
}
