import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { createCustomItem, shoppingItemsByUrgency } from '@/stories/fixtures'
import { Card, CardContent } from '@/components/ui/card'
import { UrgencyGroup } from './UrgencyGroup'

// WHY: Purchased items within a group intentionally render dimmer text to
// reinforce their "inactive" status. The checkbox + strikethrough already
// communicate the state — WCAG 1.4.3 exempts text in inactive UI components.
const inactiveStateA11y = {
  config: { rules: [{ id: 'color-contrast', enabled: false }] },
}

const meta = {
  title: 'Feature/Shopping/UrgencyGroup',
  component: UrgencyGroup,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Groups shopping items by urgency (today / tomorrow / this week / later). Presentational wrapper around `ShoppingItem` — header label + progress count. A manual item dated by a free-text day extra renders as a `CustomShoppingItem` row after the computed lines.',
      },
    },
  },
  args: {
    onToggleItem: fn(),
  },
  // The group lives on the shopping note's sheet, ruled rather than boxed (HON-1016).
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Card data-surface="note">
          <CardContent>
            <Story />
          </CardContent>
        </Card>
      </div>
    ),
  ],
} satisfies Meta<typeof UrgencyGroup>

export default meta
type Story = StoryObj<typeof meta>

export const UrgentItems: Story = {
  args: {
    bucket: 'today',
    items: shoppingItemsByUrgency.today,
  },
  parameters: {
    a11y: inactiveStateA11y,
    docs: {
      description: {
        story:
          '`today` bucket — shows progress count because one item is already purchased. The heading says the day, so the rows carry no due label.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByText('today')).not.toBeInTheDocument()
  },
}

export const LaterItems: Story = {
  args: {
    bucket: 'later',
    items: shoppingItemsByUrgency.later,
  },
}

// This week spans several days, so each row keeps its own day.
export const ThisWeek: Story = {
  args: {
    bucket: 'this-week',
    items: shoppingItemsByUrgency['this-week'],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Tuesday')).toBeInTheDocument()
    await expect(canvas.getByText('Wednesday')).toBeInTheDocument()
  },
}

export const Tomorrow: Story = {
  args: {
    bucket: 'tomorrow',
    items: shoppingItemsByUrgency.tomorrow,
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByText('tomorrow')).not.toBeInTheDocument()
  },
}

// HON-1310: a free-text day extra ("chips" tomorrow) puts its manual item
// under its day, after the computed lines, with the same tick and delete as in
// the manual items section.
export const WithManualItem: Story = {
  args: {
    bucket: 'tomorrow',
    items: shoppingItemsByUrgency.tomorrow,
    customItems: [
      createCustomItem({
        id: 'custom-chips',
        name: 'chips',
        ingredientId: null,
        ingredientCategory: null,
        neededBy: '2026-04-21',
      }),
    ],
    onToggleCustomItem: fn(),
    onUnlinkCustomItem: fn(),
    onDeleteCustomItem: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const total = args.items.length + 1
    await expect(canvas.getByRole('heading', { name: `Tomorrow ${total}` })).toBeInTheDocument()
    const rows = canvas.getAllByRole('checkbox')
    await expect(rows).toHaveLength(total)
    await expect(rows.at(-1)).toHaveAccessibleName(/chips/)
    await userEvent.click(rows.at(-1)!)
    await expect(args.onToggleCustomItem).toHaveBeenCalledWith('custom-chips', true)
  },
}

export const Mixed: Story = {
  args: {
    bucket: 'today',
    items: shoppingItemsByUrgency.today,
  },
  parameters: {
    a11y: inactiveStateA11y,
    docs: {
      description: {
        story: 'All four urgency buckets stacked — used for visual review of the full ordering.',
      },
    },
  },
  render: (args) => (
    <div className="flex flex-col gap-6">
      <UrgencyGroup {...args} bucket="today" items={shoppingItemsByUrgency.today} />
      <UrgencyGroup bucket="tomorrow" items={shoppingItemsByUrgency.tomorrow} onToggleItem={fn()} />
      <UrgencyGroup
        bucket="this-week"
        items={shoppingItemsByUrgency['this-week']}
        onToggleItem={fn()}
      />
      <UrgencyGroup bucket="later" items={shoppingItemsByUrgency.later} onToggleItem={fn()} />
    </div>
  ),
}

// The play functions above assert only which buckets show the row's day. The
// toggle callback is a pass-through to ShoppingItem, which has its own
// play-function regression test, so it is not repeated here.
