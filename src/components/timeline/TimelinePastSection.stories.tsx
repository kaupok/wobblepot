import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import {
  createPlanEntry,
  createTimelineDay,
  lemonGarlicChickenPantry,
  lemonGarlicChickenPantryItems,
} from '@/stories/fixtures'
import { TimelinePastSection } from './TimelinePastSection'

const yesterdayEntry = createPlanEntry({
  id: 'entry-past-1',
  date: '2026-04-14',
  status: 'completed',
  rating: 'up',
})

const twoDaysAgoEntry = createPlanEntry({
  id: 'entry-past-2',
  date: '2026-04-13',
  status: 'planned',
})

const threeDaysAgoEntry = createPlanEntry({
  id: 'entry-past-3',
  date: '2026-04-12',
  status: 'skipped',
})

const pastDaysWithCatchUp = [
  createTimelineDay({
    date: '2026-04-14',
    label: 'Tuesday Apr 14',
    isToday: false,
    isPast: true,
    entries: [yesterdayEntry],
  }),
  createTimelineDay({
    date: '2026-04-13',
    label: 'Monday Apr 13',
    isToday: false,
    isPast: true,
    entries: [twoDaysAgoEntry],
  }),
]

const pastDaysAllResolved = [
  createTimelineDay({
    date: '2026-04-14',
    label: 'Tuesday Apr 14',
    isToday: false,
    isPast: true,
    entries: [yesterdayEntry],
  }),
  createTimelineDay({
    date: '2026-04-12',
    label: 'Sunday Apr 12',
    isToday: false,
    isPast: true,
    entries: [threeDaysAgoEntry],
  }),
]

const meta = {
  title: 'Feature/Timeline/TimelinePastSection',
  component: TimelinePastSection,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    planId: 'plan-1',
    householdSize: 4,
    pantryIngredients: lemonGarlicChickenPantry,
    pantryItems: lemonGarlicChickenPantryItems,
    onEntryUpdated: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TimelinePastSection>

export default meta
type Story = StoryObj<typeof meta>

export const CollapsedWithCatchUp: Story = {
  args: { days: pastDaysWithCatchUp },
}

export const CollapsedAllResolved: Story = {
  args: { days: pastDaysAllResolved },
  parameters: {
    docs: {
      description: {
        story: 'No planned past meals — the amber "to catch up" badge is hidden.',
      },
    },
  },
}

export const NoDays: Story = {
  args: { days: [] },
  parameters: {
    docs: {
      description: {
        story: 'Component returns null — nothing renders when there is no past history.',
      },
    },
  },
}

// Expanding reveals the past day cards. The meal cards rendered inside include
// action buttons, so inactive-state contrast is waived for this exercise.
const inactiveStateA11y = {
  config: { rules: [{ id: 'color-contrast', enabled: false }] },
}

export const ExpandsToRevealDays: Story = {
  args: { days: pastDaysWithCatchUp },
  parameters: { a11y: inactiveStateA11y },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = canvas.getByRole('button', { name: /show past meals/i })
    await userEvent.click(toggle)
    await expect(canvas.getByText(/tuesday apr 14/i)).toBeVisible()
    await expect(canvas.getByText(/monday apr 13/i)).toBeVisible()
  },
}
