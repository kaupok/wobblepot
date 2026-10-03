import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { MealType } from '@/generated/prisma/enums'
import {
  createMeal,
  createPlanEntry,
  createTimelineDay,
  lemonGarlicChickenPantry,
  lemonGarlicChickenPantryItems,
} from '@/stories/fixtures'
import mealIllustration from '@/stories/assets/meal-illustration-white.png'
import { slowCreateEntryHandlers } from '@/stories/msw-handlers'
import { TimelineDayCard } from './TimelineDayCard'

const meta = {
  title: 'Feature/Timeline/TimelineDayCard',
  component: TimelineDayCard,
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
} satisfies Meta<typeof TimelineDayCard>

export default meta
type Story = StoryObj<typeof meta>

export const TodayWithDinner: Story = {
  args: {
    day: createTimelineDay(),
  },
}

export const TomorrowEmpty: Story = {
  args: {
    day: createTimelineDay({
      date: '2026-04-16',
      label: 'Tomorrow',
      isToday: false,
      isTomorrow: true,
      entries: [],
      emptySlots: [MealType.dinner],
    }),
  },
}

export const FutureDay: Story = {
  args: {
    day: createTimelineDay({
      date: '2026-04-18',
      label: 'Saturday Apr 18',
      isToday: false,
      isTomorrow: false,
      entries: [
        createPlanEntry({
          id: 'entry-fut-1',
          date: '2026-04-18',
          mealType: MealType.dinner,
        }),
      ],
    }),
  },
}

export const AllDayMealTypes: Story = {
  args: {
    day: createTimelineDay({
      date: '2026-04-17',
      label: 'Friday Apr 17',
      isToday: false,
      entries: [
        createPlanEntry({
          id: 'entry-bkfast',
          date: '2026-04-17',
          mealType: MealType.breakfast,
        }),
        createPlanEntry({
          id: 'entry-lunch',
          date: '2026-04-17',
          mealType: MealType.lunch,
        }),
        createPlanEntry({
          id: 'entry-dinner',
          date: '2026-04-17',
          mealType: MealType.dinner,
        }),
      ],
    }),
  },
  parameters: {
    docs: {
      description: {
        story: 'Breakfast / lunch / dinner in meal-type order regardless of array order.',
      },
    },
  },
}

export const MixedEntriesAndEmpty: Story = {
  args: {
    day: createTimelineDay({
      date: '2026-04-17',
      label: 'Friday Apr 17',
      isToday: false,
      entries: [
        createPlanEntry({
          id: 'entry-dinner',
          date: '2026-04-17',
          mealType: MealType.dinner,
        }),
      ],
      emptySlots: [MealType.breakfast, MealType.lunch],
    }),
  },
  parameters: {
    docs: {
      description: {
        story: 'One filled dinner with empty breakfast + lunch slots above it.',
      },
    },
  },
}

export const AllEmpty: Story = {
  args: {
    day: createTimelineDay({
      date: '2026-04-17',
      label: 'Friday Apr 17',
      isToday: false,
      entries: [],
      emptySlots: [MealType.dinner],
    }),
  },
}

export const NoMealsExpected: Story = {
  args: {
    day: createTimelineDay({
      date: '2026-04-18',
      label: 'Saturday Apr 18',
      isToday: false,
      entries: [],
      emptySlots: [],
    }),
  },
  parameters: {
    docs: {
      description: {
        story:
          '`expectedMealTypes` is empty for this day, so no slots render — "No meals planned" copy fills the card.',
      },
    },
  },
}

// Past days render at full opacity and without a `color-contrast` waiver: their
// cards are what "N to catch up" asks the user to act on, so axe measures them
// like any other card (HON-805).
export const PastCompleted: Story = {
  args: {
    day: createTimelineDay({
      date: '2026-04-14',
      label: 'Tuesday Apr 14',
      isToday: false,
      isPast: true,
      entries: [
        createPlanEntry({
          id: 'entry-past',
          date: '2026-04-14',
          status: 'completed',
          rating: 'up',
        }),
      ],
    }),
  },
  parameters: {
    docs: {
      description: {
        story: 'Past day — empty slots are hidden and each card shows its status control.',
      },
    },
  },
}

export const PastWithImage: Story = {
  args: {
    day: createTimelineDay({
      date: '2026-04-14',
      label: 'Tuesday Apr 14',
      isToday: false,
      isPast: true,
      entries: [
        createPlanEntry({
          id: 'entry-past-image',
          date: '2026-04-14',
          status: 'completed',
          rating: 'up',
          note: 'Kids asked for seconds. Use less garlic next time.',
          meal: createMeal({
            imageStatus: 'ready',
            imageUrl: mealIllustration.src,
            imageHue: 52,
          }),
        }),
      ],
    }),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Past day whose card has an image and a hue tint. The image is confined to the title band, and the status, rating and note sit on the tint at full contrast.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    // Nothing between the day and the page may fade it (HON-805).
    let node: Element | null = within(canvasElement).getByRole('heading', {
      name: /tuesday apr 14/i,
    })
    while (node && node !== canvasElement) {
      await expect(getComputedStyle(node).opacity).toBe('1')
      node = node.parentElement
    }
  },
}

// WHY: Empty-slot "Pick a meal" buttons render on a dashed outline; axe flags
// the surrounding muted placeholder text. The text is informational for
// sighted users while the button is the real action — waive only that rule.
const emptySlotA11y = {
  config: { rules: [{ id: 'color-contrast', enabled: false }] },
}

// Play story — verify the "Pick a meal" button in an empty slot is reachable
// and activates the empty-slot create flow. This is the user-facing entry
// point when there is nothing planned yet for a day.
export const PickMealFromEmptySlot: Story = {
  args: {
    day: createTimelineDay({
      date: '2026-04-17',
      label: 'Friday Apr 17',
      isToday: false,
      entries: [],
      emptySlots: [MealType.dinner],
    }),
  },
  parameters: {
    a11y: emptySlotA11y,
    msw: { handlers: slowCreateEntryHandlers },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const pick = canvas.getByRole('button', { name: /pick a meal/i })
    await userEvent.click(pick)
    // `aria-disabled`, not `disabled`, so it keeps focus while pending (HON-803).
    await expect(canvas.getByRole('button', { name: /adding…/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  },
}
