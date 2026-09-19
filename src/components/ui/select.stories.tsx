import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
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

// The default `SelectTrigger` is 44px at the mobile viewport and 40px here;
// `SmallSize` stays 32px at both. Same a11y waiver as `AllVariants` — it
// renders the same disabled trigger.
export const Desktop: Story = {
  parameters: {
    a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } },
  },
  globals: {
    viewport: { value: 'desktop', isRotated: false },
  },
  render: AllVariants.render,
}

// Guards HON-690: opening a Select locks page scroll (react-remove-scroll-bar),
// which on classic-scrollbar systems used to drop the scrollbar and widen the
// viewport, sliding the fixed header and tab bar sideways. The page is taller
// than the viewport so the document scrolls; a fixed full-width bar stands in
// for the header. The play function asserts that neither the fixed bar's
// centred content nor the in-flow trigger moves under the lock, and that the
// library's compensating body margin is zeroed. Removing either rule in
// globals.css fails it. (`documentElement.clientWidth` is not asserted:
// Chromium stops subtracting the reserved gutter from it once overflow is
// hidden, although layout keeps the gutter.)
export const ScrollLockKeepsLayout: Story = {
  // A fixed bar and a 200vh page would sit on top of the autodocs page.
  tags: ['!autodocs'],
  parameters: { layout: 'padded' },
  render: () => (
    <div className="flex h-[200vh] flex-col pt-16">
      <div className="bg-background fixed inset-x-0 top-0 border-b py-2">
        <p data-testid="fixed-chrome" className="mx-auto w-48 text-center">
          Fixed header
        </p>
      </div>
      <Select defaultValue="Monday">
        <SelectTrigger aria-label="Day of week" className="mx-auto w-48">
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('combobox', { name: 'Day of week' })
    const chrome = canvas.getByTestId('fixed-chrome')
    const triggerLeft = trigger.getBoundingClientRect().left
    const chromeLeft = chrome.getBoundingClientRect().left

    await userEvent.click(trigger)
    await within(document.body).findByRole('listbox')
    await waitFor(() => expect(document.body).toHaveAttribute('data-scroll-locked'))

    expect(chrome.getBoundingClientRect().left).toBe(chromeLeft)
    expect(trigger.getBoundingClientRect().left).toBe(triggerLeft)
    expect(window.getComputedStyle(document.body).marginRight).toBe('0px')

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(document.body).not.toHaveAttribute('data-scroll-locked'))
  },
}
