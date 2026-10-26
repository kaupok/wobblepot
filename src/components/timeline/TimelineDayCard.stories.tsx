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
import { mixedExtras } from '@/stories/day-extra-fixtures'
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

/**
 * Every slot is full and the day has extras (HON-1309): "+ Extra" sits alone
 * on the heading, not a one-item "+ Add" menu (HON-1335), and the extras take
 * one row under the meal.
 */
export const FullDayWithExtras: Story = {
  args: {
    day: createTimelineDay({ extras: mixedExtras }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Add an extra: Today' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Add to Today' })).toBeNull()
    await expect(canvas.getByRole('button', { name: 'Edit extra: Red wine 750ml' })).toBeVisible()
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

// One "+ Add" button on the heading's line holds the empty slots, in
// meal-type order, and the planned dinner is the only card below it
// (HON-1111, HON-1335).
export const MixedEntriesAndEmpty: Story = {
  args: { day: mixedDay },
  parameters: {
    docs: {
      description: {
        story:
          'One planned dinner; the "+ Add" menu on the heading line offers the empty breakfast and lunch slots, then Extra.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const add = canvas.getByRole('button', { name: 'Add to Friday Apr 17' })
    const headingRow = canvas.getByRole('heading', { level: 2 }).parentElement
    await expect(headingRow).toContainElement(add)
    await expect(canvas.queryByRole('button', { name: /^Add an extra/ })).toBeNull()
    await userEvent.click(add)
    const menu = await within(document.body).findByRole('menu')
    const groups = within(menu).getAllByRole('group')
    await expect(groups.map((group) => group.firstElementChild?.textContent)).toEqual([
      'Breakfast',
      'Lunch',
    ])
    await userEvent.keyboard('{Escape}')
  },
}

/** Estonian: "+ Lisa", with the day after a separator in its name. */
export const MixedEntriesAndEmptyEstonian: Story = {
  args: { day: mixedDay },
  globals: { locale: 'et' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Lisa: Friday Apr 17' })).toHaveTextContent(
      /^Lisa$/,
    )
  },
}

/** A phone width: one "+ Add" button for three empty slots, beside the heading. */
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

// Play story — verify the day's "+ Add" button is reachable and activates
// the empty-slot create flow. This is the user-facing entry
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
    const add = canvas.getByRole('button', { name: 'Add to Friday Apr 17' })
    await userEvent.click(add)
    // The day's button opens the routes to a meal per slot (HON-1247, HON-1335).
    await userEvent.click(
      await within(document.body).findByRole('menuitem', { name: 'Choose a recipe' }),
    )
    // `aria-disabled`, not `disabled`, so it keeps focus while pending (HON-803).
    await expect(canvas.getByRole('button', { name: /adding…/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  },
}

/** After a clear, once the slot is empty, the day's "+ Add" takes focus (HON-1123). */
export const FocusesAddAfterClear: Story = {
  args: { day: mixedDay, focusSlot: MealType.lunch, onSlotFocused: fn() },
  play: async ({ canvasElement, args }) => {
    const add = within(canvasElement).getByRole('button', { name: 'Add to Friday Apr 17' })
    await expect(args.onSlotFocused).toHaveBeenCalledTimes(1)
    await expect(document.activeElement).toBe(add)
  },
}

/**
 * After a generation removed the Generate button, the day heading takes focus
 * (HON-1139). `tabIndex={-1}` keeps it out of the tab order.
 */
export const FocusesHeading: Story = {
  args: { day: mixedDay, focusHeading: true, onHeadingFocused: fn() },
  play: async ({ canvasElement, args }) => {
    const heading = within(canvasElement).getByRole('heading', { name: /friday apr 17/i })
    await expect(args.onHeadingFocused).toHaveBeenCalledTimes(1)
    await expect(document.activeElement).toBe(heading)
    await expect(heading).toHaveAttribute('tabindex', '-1')
  },
}
