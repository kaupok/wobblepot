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
const months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

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

// WHY: Disabled Select triggers render at 50% opacity, dipping below 4.5:1 on
// the placeholder text. WCAG 1.4.3 exempts inactive UI components from the
// contrast rule — axe can't infer the disabled state, so waive only
// `color-contrast`.
export const AllVariants: Story = {
  parameters: {
    a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } },
  },
  render: () => (
    <div className="grid gap-6 sm:grid-cols-2">
      <section className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs">Placeholder</p>
        <Select>
          <SelectTrigger aria-label="Placeholder day" className="w-48">
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
      </section>
      <section className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs">With value</p>
        <Select defaultValue="Wednesday">
          <SelectTrigger aria-label="Selected day" className="w-48">
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
      </section>
      <section className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs">Disabled</p>
        <Select defaultValue="Monday" disabled>
          <SelectTrigger aria-label="Disabled day" className="w-48">
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
      </section>
      <section className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs">Many options (scroll)</p>
        <Select defaultValue="January">
          <SelectTrigger aria-label="Month" className="w-48">
            <SelectValue placeholder="Pick a month" />
          </SelectTrigger>
          <SelectContent>
            {months.map((month) => (
              <SelectItem key={month} value={month}>
                {month}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>
    </div>
  ),
}
