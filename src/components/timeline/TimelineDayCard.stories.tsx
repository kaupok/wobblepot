import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { MealType } from '@/generated/prisma/enums'
import {
  createPlanEntry,
  createTimelineDay,
  lemonGarlicChickenPantry,
  lemonGarlicChickenPantryItems,
} from '@/stories/fixtures'
import { slowCreateEntryHandlers } from '@/stories/msw-handlers'
import { TimelineDayCard } from './TimelineDayCard'

const meta = {
  title: 'Feature/Timeline/TimelineDayCard',
  component: TimelineDayCard,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    planId: 'plan-1',
    householdServings: 4,
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

const mixedDay = createTimelineDay({
  date: '2026-04-17',
  label: 'Friday',
  dateLabel: 'Apr 17',
  isToday: false,
  entries: [
    createPlanEntry({
      id: 'entry-dinner',
      date: '2026-04-17',
      mealType: MealType.dinner,
    }),
  ],
  emptySlots: [MealType.breakfast, MealType.lunch],
})

// The empty slots are buttons on the heading's line, in meal-type order, and
// the planned dinner is the only card below it (HON-1111).
export const MixedEntriesAndEmpty: Story = {
  args: { day: mixedDay },
  parameters: {
    docs: {
      description: {
        story:
          'One planned dinner with empty breakfast and lunch slots as buttons on the heading line.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const breakfast = canvas.getByRole('button', {
      name: 'Breakfast: pick a meal, Friday Apr 17',
    })
    const lunch = canvas.getByRole('button', { name: 'Lunch: pick a meal, Friday Apr 17' })
    const headingRow = canvas.getByRole('heading', { level: 2 }).parentElement
    await expect(headingRow).toContainElement(breakfast)
    await expect(headingRow).toContainElement(lunch)
    await expect(
      breakfast.compareDocumentPosition(lunch) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  },
}

/** Estonian meal names are longer, so the buttons wrap below the heading sooner. */
export const MixedEntriesAndEmptyEstonian: Story = {
  args: { day: mixedDay },
  globals: { locale: 'et' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: 'Hommikusöök: vali toit, Friday Apr 17' }),
    ).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'Lõunasöök: vali toit, Friday Apr 17' }),
    ).toBeVisible()
  },
}

/** A phone width: the buttons wrap below the heading, together, from the left. */
export const ThreeEmptySlotsNarrow: Story = {
  args: {
    day: createTimelineDay({
      date: '2026-04-17',
      label: 'Wednesday',
      dateLabel: 'Apr 17',
      isToday: false,
      entries: [],
      emptySlots: [MealType.breakfast, MealType.lunch, MealType.dinner],
    }),
  },
  globals: { locale: 'et' },
  decorators: [
    (Story) => (
      <div className="max-w-xs">
        <Story />
      </div>
    ),
  ],
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

// Play story — verify the "+ Dinner" button of an empty slot is reachable
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
    msw: { handlers: slowCreateEntryHandlers },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const pick = canvas.getByRole('button', { name: /^Dinner: pick a meal/ })
    await userEvent.click(pick)
    // `aria-disabled`, not `disabled`, so it keeps focus while pending (HON-803).
    await expect(canvas.getByRole('button', { name: /adding…/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  },
}

/** After a clear, the slot that replaced the card takes focus (HON-1123). */
export const FocusesClearedSlot: Story = {
  args: { day: mixedDay, focusSlot: MealType.lunch, onSlotFocused: fn() },
  play: async ({ canvasElement, args }) => {
    const lunch = within(canvasElement).getByRole('button', {
      name: 'Lunch: pick a meal, Friday Apr 17',
    })
    await expect(args.onSlotFocused).toHaveBeenCalledTimes(1)
    await expect(document.activeElement).toBe(lunch)
  },
}
