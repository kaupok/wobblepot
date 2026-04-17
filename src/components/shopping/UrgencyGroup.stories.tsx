import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import { shoppingItemsByUrgency } from '@/stories/fixtures'
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
          'Groups shopping items by urgency (today / tomorrow / this week / later). Presentational wrapper around `ShoppingItem` — header label + progress count.',
      },
    },
  },
  args: {
    onToggleItem: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
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
        story: '`today` bucket — shows progress count because one item is already purchased.',
      },
    },
  },
}

export const LaterItems: Story = {
  args: {
    bucket: 'later',
    items: shoppingItemsByUrgency.later,
  },
}

export const ThisWeek: Story = {
  args: {
    bucket: 'this-week',
    items: shoppingItemsByUrgency['this-week'],
  },
}

export const Tomorrow: Story = {
  args: {
    bucket: 'tomorrow',
    items: shoppingItemsByUrgency.tomorrow,
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

// WHY: No play story — UrgencyGroup is purely presentational. Its only
// callback (`onToggleItem`) is a pass-through to ShoppingItem, which has its
// own play-function regression test. Adding one here would duplicate coverage.
