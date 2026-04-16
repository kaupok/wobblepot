import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Label } from './label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './select'

const meta = {
  title: 'UI/Select',
  component: Select,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Portal-based select. Toggle the theme toolbar to verify content renders correctly in dark mode.',
      },
    },
  },
} satisfies Meta<typeof Select>

export default meta
type Story = StoryObj<typeof meta>

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export const Default: Story = {
  render: () => (
    <Select defaultValue="Monday">
      <SelectTrigger aria-label="Day of week" className="w-48">
        <SelectValue placeholder="Pick a day" />
      </SelectTrigger>
      <SelectContent>
        {days.map((day) => (
          <SelectItem key={day} value={day}>
            {day}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
}

export const Placeholder: Story = {
  render: () => (
    <Select>
      <SelectTrigger aria-label="Day of week" className="w-48">
        <SelectValue placeholder="Pick a day" />
      </SelectTrigger>
      <SelectContent>
        {days.map((day) => (
          <SelectItem key={day} value={day}>
            {day}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
}

export const WithDisabledOption: Story = {
  render: () => (
    <Select defaultValue="planned">
      <SelectTrigger aria-label="Status" className="w-48">
        <SelectValue placeholder="Status" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="planned">Planned</SelectItem>
        <SelectItem value="completed">Completed</SelectItem>
        <SelectItem value="skipped" disabled>
          Skipped (locked)
        </SelectItem>
      </SelectContent>
    </Select>
  ),
}

export const WithGroups: Story = {
  render: () => (
    <Select defaultValue="dinner">
      <SelectTrigger aria-label="Meal type" className="w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Daily</SelectLabel>
          <SelectItem value="breakfast">Breakfast</SelectItem>
          <SelectItem value="lunch">Lunch</SelectItem>
          <SelectItem value="dinner">Dinner</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Other</SelectLabel>
          <SelectItem value="snack">Snack</SelectItem>
          <SelectItem value="dessert">Dessert</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
}

export const WithLabel: Story = {
  render: () => (
    <div className="grid w-48 gap-2">
      <Label htmlFor="meal-day">Day</Label>
      <Select defaultValue="Monday">
        <SelectTrigger id="meal-day">
          <SelectValue placeholder="Pick a day" />
        </SelectTrigger>
        <SelectContent>
          {days.map((day) => (
            <SelectItem key={day} value={day}>
              {day}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  ),
}

export const SmallSize: Story = {
  render: () => (
    <Select defaultValue="Monday">
      <SelectTrigger size="sm" aria-label="Day of week" className="w-40">
        <SelectValue placeholder="Pick a day" />
      </SelectTrigger>
      <SelectContent>
        {days.map((day) => (
          <SelectItem key={day} value={day}>
            {day}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
}
