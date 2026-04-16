import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Label } from './label'
import { Textarea } from './textarea'

const meta = {
  title: 'UI/Textarea',
  component: Textarea,
  tags: ['autodocs'],
  argTypes: {
    disabled: { control: 'boolean' },
  },
  args: {
    placeholder: 'Add a note…',
  },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Textarea>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <div className="w-80">
      <Textarea {...args} />
    </div>
  ),
}

export const Disabled: Story = {
  args: { disabled: true, defaultValue: 'Disabled note.' },
  render: (args) => (
    <div className="w-80">
      <Textarea {...args} />
    </div>
  ),
}

export const WithValue: Story = {
  args: { defaultValue: 'Kids loved this — double the garlic next time.' },
  render: (args) => (
    <div className="w-80">
      <Textarea {...args} />
    </div>
  ),
}

export const MultiLine: Story = {
  args: {
    defaultValue:
      'Step 1: Marinate the chicken.\nStep 2: Roast at 425°F for 35 minutes.\nStep 3: Broil last 2 minutes.\nStep 4: Rest 5 minutes before slicing.',
  },
  render: (args) => (
    <div className="w-80">
      <Textarea {...args} />
    </div>
  ),
}

export const Invalid: Story = {
  args: { 'aria-invalid': true, defaultValue: '' },
  render: (args) => (
    <div className="w-80">
      <Textarea {...args} />
    </div>
  ),
}

export const WithLabel: Story = {
  render: () => (
    <div className="grid w-80 gap-2">
      <Label htmlFor="meal-note">Meal note</Label>
      <Textarea id="meal-note" placeholder="What did the family think?" />
    </div>
  ),
}
