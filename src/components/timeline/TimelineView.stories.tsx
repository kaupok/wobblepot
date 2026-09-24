import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { MealType } from '@/generated/prisma/enums'
import {
  createExpectedMealTypes,
  createPlanEntry,
  lemonGarlicChickenPantry,
  lemonGarlicChickenPantryItems,
  timelineTodayDate,
  urgentShoppingItems,
} from '@/stories/fixtures'
import { pressEscape } from '@/stories/a11y-helpers'
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
          'Typical mid-week view: past history (collapsed), a few planned days, then the fill-days action sits after the last planned day and above the empty future days.',
      },
    },
  },
}

/**
 * Phone width (the default viewport): the compact shopping summary leads the
 * screen and the sidebar panel is hidden, instead of rendering after the whole
 * 14-day timeline (HON-766).
 */
export const PhoneShoppingSummary: Story = {
  args: {
    entries: baseEntries,
  },
  globals: {
    viewport: { value: 'mobileIphone', isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Both forms are in the markup; below lg only the compact one shows.
    const [summary, sidebarSummary] = canvas.getAllByText(/^Need /)
    await expect(summary).toBeVisible()
    await expect(sidebarSummary).not.toBeVisible()
    // One Shopping panel in the accessibility tree: the full one is display:none.
    await expect(canvas.getAllByRole('link', { name: 'View full list' })).toHaveLength(1)
    const [today] = canvas.getAllByText('Today')
    await expect(
      (summary as Node).compareDocumentPosition(today as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  },
}

export const DinnersPlannedBreakfastsEmpty: Story = {
  args: {
    expectedMealTypes: createExpectedMealTypes({
      weekdayMealTypes: [MealType.breakfast, MealType.dinner],
      weekendMealTypes: [MealType.breakfast, MealType.dinner],
    }),
    entries: [
      createPlanEntry({ id: 'e-today-breakfast', mealType: MealType.breakfast }),
      ...['2026-04-15', '2026-04-16', '2026-04-17', '2026-04-18'].map((date) =>
        createPlanEntry({ id: `e-dinner-${date}`, date, mealType: MealType.dinner }),
      ),
    ],
  },
  parameters: {
    docs: {
      description: {
        story:
          'Dinners planned through Saturday, breakfasts empty after today (HON-758). The fill-days action sits after Saturday — the last day with anything planned — and fills from Sunday. The empty breakfasts above it are filled per slot.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const label = canvas.getByText(/^Fill Apr 19\s*–\s*25$/)
    const saturday = canvas.getByRole('heading', { name: /saturday.*18/i })
    const sunday = canvas.getByRole('heading', { name: /sunday.*19/i })
    await expect(
      saturday.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    await expect(
      label.compareDocumentPosition(sunday) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  },
}

// Past day cards include meal-card action buttons, so inactive-state contrast
// is waived for the stories that expand them.
const inactiveStateA11y = {
  config: { rules: [{ id: 'color-contrast', enabled: false }] },
}

export const ShowPastMeals: Story = {
  args: {
    entries: baseEntries,
  },
  parameters: {
    a11y: inactiveStateA11y,
    docs: {
      description: {
        story:
          'The ⋯ menu on the Today heading reveals past days above Today and scrolls the first one into view. One past dinner is still planned, so the trigger carries a warning dot and the count.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)
    const trigger = canvas.getByRole('button', {
      name: 'Timeline options, 1 past meal to catch up',
    })

    // Collapsed: no past day is on the page.
    await expect(canvas.queryByRole('heading', { name: /tuesday.*14/i })).not.toBeInTheDocument()

    // Escape closes the menu without revealing anything.
    await userEvent.click(trigger)
    await expect(await body.findByRole('menu')).toBeInTheDocument()
    await pressEscape()
    await waitFor(() => expect(body.queryByRole('menu')).not.toBeInTheDocument())
    await expect(canvas.queryByRole('heading', { name: /tuesday.*14/i })).not.toBeInTheDocument()

    await userEvent.click(trigger)
    await userEvent.click(
      await body.findByRole('menuitem', { name: 'Show past meals · 1 to catch up' }),
    )
    await expect(await canvas.findByRole('heading', { name: /tuesday.*14/i })).toBeInTheDocument()
    await expect(canvas.getByRole('heading', { name: /monday.*13/i })).toBeInTheDocument()

    // The item now reads "Hide", and hiding removes the past days again.
    await userEvent.click(trigger)
    await userEvent.click(await body.findByRole('menuitem', { name: /hide past meals/i }))
    await waitFor(() =>
      expect(canvas.queryByRole('heading', { name: /tuesday.*14/i })).not.toBeInTheDocument(),
    )
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
          'No entries at all — the fill-days action shows up immediately, followed by the full 14-day empty window. With no past days there is no ⋯ menu on Today.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole('button', { name: /timeline options/i }),
    ).not.toBeInTheDocument()
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
        story:
          'The next 7 days are planned — the fill-days action sits after the seventh day, followed by the empty days.',
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
