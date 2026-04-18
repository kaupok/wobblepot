import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { MealType } from '@/generated/prisma/enums'
import {
  createExpectedMealTypes,
  createPlanEntry,
  lemonGarlicChickenPantry,
  lemonGarlicChickenPantryItems,
  timelineTodayDate,
  urgentShoppingItems,
} from '@/stories/fixtures'
import { TimelineView } from './TimelineView'

const baseEntries = [
  createPlanEntry({
    id: 'e-today',
    date: timelineTodayDate,
    mealType: MealType.dinner,
  }),
  createPlanEntry({
    id: 'e-tomorrow',
    date: '2026-04-16',
    mealType: MealType.dinner,
  }),
  createPlanEntry({
    id: 'e-day3',
    date: '2026-04-17',
    mealType: MealType.dinner,
  }),
  createPlanEntry({
    id: 'e-past-1',
    date: '2026-04-14',
    mealType: MealType.dinner,
    status: 'completed',
    rating: 'up',
  }),
  createPlanEntry({
    id: 'e-past-2',
    date: '2026-04-13',
    mealType: MealType.dinner,
    status: 'planned',
  }),
]

const meta = {
  title: 'Feature/Timeline/TimelineView',
  component: TimelineView,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    planId: 'plan-1',
    householdSize: 4,
    expectedMealTypes: createExpectedMealTypes(),
    pantryIngredients: lemonGarlicChickenPantry,
    pantryItems: lemonGarlicChickenPantryItems,
    shoppingItems: urgentShoppingItems,
    todayDate: timelineTodayDate,
  },
} satisfies Meta<typeof TimelineView>

export default meta
type Story = StoryObj<typeof meta>

export const PlannedThenEmpty: Story = {
  args: {
    entries: baseEntries,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Typical mid-week view: past history (collapsed), a few planned days, then the fill-days action sits above empty future days.',
      },
    },
  },
}

export const AllEmpty: Story = {
  args: {
    entries: [],
  },
  parameters: {
    docs: {
      description: {
        story:
          'No entries at all — the fill-days action shows up immediately, followed by the full 14-day empty window.',
      },
    },
  },
}

export const FullyPlanned: Story = {
  args: {
    entries: Array.from({ length: 7 }, (_, i) => {
      const day = new Date('2026-04-15')
      day.setDate(day.getDate() + i)
      const iso = day.toISOString().slice(0, 10)
      return createPlanEntry({
        id: `e-planned-${iso}`,
        date: iso,
        mealType: MealType.dinner,
      })
    }),
  },
  parameters: {
    docs: {
      description: {
        story: 'The next 7 days are planned — no fill-days action, empty days start after that.',
      },
    },
  },
}

export const PastOnly: Story = {
  args: {
    entries: [
      createPlanEntry({
        id: 'e-past-old',
        date: '2026-04-12',
        mealType: MealType.dinner,
        status: 'completed',
        rating: 'up',
      }),
      createPlanEntry({
        id: 'e-past-catch',
        date: '2026-04-14',
        mealType: MealType.dinner,
        status: 'planned',
      }),
    ],
  },
  parameters: {
    docs: {
      description: {
        story:
          'Only past entries — future section is fully empty and the fill-days action shows immediately.',
      },
    },
  },
}

export const EmptyShoppingSidebar: Story = {
  args: {
    entries: baseEntries,
    shoppingItems: [],
  },
  parameters: {
    docs: {
      description: {
        story:
          'Timeline populated, but no upcoming shopping items — sidebar shows the "all set" state.',
      },
    },
  },
}

export const BreakfastLunchDinner: Story = {
  args: {
    expectedMealTypes: createExpectedMealTypes({
      weekdayMealTypes: [MealType.breakfast, MealType.lunch, MealType.dinner],
      weekendMealTypes: [MealType.breakfast, MealType.lunch, MealType.dinner],
    }),
    entries: [
      createPlanEntry({
        id: 'e-bkfast',
        date: timelineTodayDate,
        mealType: MealType.breakfast,
      }),
      createPlanEntry({
        id: 'e-lunch',
        date: timelineTodayDate,
        mealType: MealType.lunch,
      }),
      createPlanEntry({
        id: 'e-dinner',
        date: timelineTodayDate,
        mealType: MealType.dinner,
      }),
    ],
  },
  parameters: {
    docs: {
      description: {
        story:
          'Household plans all three meal types — today is fully planned, future days show three empty slots each.',
      },
    },
  },
}
