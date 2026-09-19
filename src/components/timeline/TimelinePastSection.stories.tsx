import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, within } from 'storybook/test'
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

// The past day cards include meal-card action buttons, so inactive-state
// contrast is waived — same as the other expanded timeline stories.
const inactiveStateA11y = {
  config: { rules: [{ id: 'color-contrast', enabled: false }] },
}

export const Expanded: Story = {
  args: { days: pastDaysWithCatchUp, expanded: true },
  parameters: { a11y: inactiveStateA11y },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/tuesday apr 14/i)).toBeVisible()
    await expect(canvas.getByText(/monday apr 13/i)).toBeVisible()

    // The list is the scroll target on expand; its scroll margin keeps the
    // first day clear of the fixed header (80px = h-16 row + 1rem, no notch).
    const list = canvasElement.querySelector('.scroll-mt-below-header')
    await expect(list).not.toBeNull()
    await expect(getComputedStyle(list as Element).scrollMarginTop).toBe('80px')
  },
}

export const ExpandedAllResolved: Story = {
  args: { days: pastDaysAllResolved, expanded: true },
  parameters: { a11y: inactiveStateA11y },
}

export const Collapsed: Story = {
  args: { days: pastDaysWithCatchUp, expanded: false },
  parameters: {
    docs: {
      description: {
        story:
          'Renders nothing — the show/hide control lives in the ⋯ menu on the Today heading (`TimelinePastMenu`).',
      },
    },
  },
}

export const NoDays: Story = {
  args: { days: [], expanded: true },
  parameters: {
    docs: {
      description: {
        story: 'Component returns null — nothing renders when there is no past history.',
      },
    },
  },
}
