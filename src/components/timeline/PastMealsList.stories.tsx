import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { MealType } from '@/generated/prisma/enums'
import {
  createMeal,
  createPlanEntry,
  lemonGarlicChickenPantryItems,
  timelineTodayDate,
} from '@/stories/fixtures'
import { PastMealsList } from './PastMealsList'

const meta = {
  title: 'Feature/Timeline/PastMealsList',
  component: PastMealsList,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    planId: 'plan-1',
    householdSize: 4,
    pantryItems: lemonGarlicChickenPantryItems,
    todayDate: timelineTodayDate,
    entries: [
      createPlanEntry({
        id: 'e-past-3',
        date: '2026-04-12',
        mealType: MealType.dinner,
        status: 'skipped',
      }),
      createPlanEntry({
        id: 'e-past-1',
        date: '2026-04-14',
        mealType: MealType.dinner,
        status: 'planned',
      }),
      createPlanEntry({
        id: 'e-past-1b',
        date: '2026-04-14',
        mealType: MealType.breakfast,
        status: 'planned',
        meal: createMeal({ id: 'meal-porridge', name: 'Porridge with berries' }),
      }),
      // A slot with only a note: nothing to mark, so no row.
      createPlanEntry({
        id: 'e-past-note',
        date: '2026-04-14',
        mealType: MealType.lunch,
        meal: null,
        note: 'Eating out',
      }),
      createPlanEntry({
        id: 'e-past-2',
        date: '2026-04-13',
        mealType: MealType.dinner,
        status: 'completed',
        rating: 'up',
      }),
    ],
  },
} satisfies Meta<typeof PastMealsList>

export default meta
type Story = StoryObj<typeof meta>

export const NewestFirst: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The `/past-meals` list: yesterday first, because it is the day most likely to need marking. Each day is one `RowGroup` of rows, breakfast to dinner (HON-1018). Yesterday has two meals still planned, then one cooked and rated, one skipped.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const headings = within(canvasElement)
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent)
    await expect(headings).toEqual(['Tuesday Apr 14', 'Monday Apr 13', 'Sunday Apr 12'])

    // One box per day, one row per meal; the note-only lunch has no row.
    const groups = canvasElement.querySelectorAll('[data-slot="row-group"]')
    await expect(groups).toHaveLength(3)
    await expect(
      within(groups[0] as HTMLElement).getAllByRole('button', { name: 'Cooked' }),
    ).toHaveLength(2)
    await expect(groups[0]).toHaveTextContent(/Breakfast.*Porridge with berries.*Dinner/)
    await expect(canvasElement).not.toHaveTextContent('Eating out')
    // No image and no description on a row.
    await expect(within(canvasElement).queryByRole('img')).not.toBeInTheDocument()
  },
}

export const OneDay: Story = {
  args: {
    entries: [
      createPlanEntry({
        id: 'e-yesterday',
        date: '2026-04-14',
        mealType: MealType.dinner,
        status: 'planned',
      }),
    ],
  },
}

/** The longest labels, "Vahele jäetud" among them, fit their buttons. */
export const Estonian: Story = {
  globals: { locale: 'et' },
}
