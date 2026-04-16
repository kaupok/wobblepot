import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Label } from './label'
import { RadioGroup, RadioGroupItem } from './radio-group'

const meta = {
  title: 'UI/RadioGroup',
  component: RadioGroup,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof RadioGroup>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <RadioGroup defaultValue="weekly">
      <div className="flex items-center gap-2">
        <RadioGroupItem value="daily" id="daily" />
        <Label htmlFor="daily">Daily</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="weekly" id="weekly" />
        <Label htmlFor="weekly">Weekly</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="monthly" id="monthly" />
        <Label htmlFor="monthly">Monthly</Label>
      </div>
    </RadioGroup>
  ),
}

export const WithDisabledOption: Story = {
  render: () => (
    <RadioGroup defaultValue="planned">
      <div className="flex items-center gap-2">
        <RadioGroupItem value="planned" id="status-planned" />
        <Label htmlFor="status-planned">Planned</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="completed" id="status-completed" />
        <Label htmlFor="status-completed">Completed</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="skipped" id="status-skipped" disabled />
        <Label htmlFor="status-skipped">Skipped (disabled)</Label>
      </div>
    </RadioGroup>
  ),
}

export const NoSelection: Story = {
  render: () => (
    <RadioGroup>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="a" id="opt-a" />
        <Label htmlFor="opt-a">Option A</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="b" id="opt-b" />
        <Label htmlFor="opt-b">Option B</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="c" id="opt-c" />
        <Label htmlFor="opt-c">Option C</Label>
      </div>
    </RadioGroup>
  ),
}
