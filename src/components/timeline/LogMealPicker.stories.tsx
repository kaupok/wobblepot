import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, within } from 'storybook/test'

import { MealType } from '@/generated/prisma/enums'
import { defaultHandlers } from '@/stories/msw-handlers'

import { LogMealPicker } from './LogMealPicker'

const meta = {
  title: 'Feature/Timeline/LogMealPicker',
  component: LogMealPicker,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'The recipe picker for a log on Past meals (HON-1383): the meals the household cooked most in the last 30 days first, then its own recipes, with a search over the library. A pick is saved as cooked, with no pantry change. Portal-based.',
      },
    },
  },
  args: {
    open: true,
    onOpenChange: fn(),
    onSaved: fn(),
    planId: 'plan-1',
    date: '2026-10-20',
    mealType: MealType.dinner,
    dayLabel: 'Tuesday Oct 20',
    frequentMeals: [
      { id: 'meal-soup', name: 'Lentil soup' },
      { id: 'meal-pasta', name: 'Pasta with tomato sauce' },
    ],
  },
} satisfies Meta<typeof LogMealPicker>

export default meta
type Story = StoryObj<typeof meta>

/** The household's usual meals lead, the most cooked first. */
export const Frequent: Story = {
  play: async () => {
    const dialog = within(
      await within(document.body).findByRole('dialog', { name: 'Choose a recipe' }),
    )
    await expect(
      dialog.getByText('Tuesday Oct 20: Dinner. Saved as cooked. The pantry does not change.'),
    ).toBeInTheDocument()
    const frequent = within(dialog.getByRole('region', { name: 'Cooked often lately' }))
    await expect(frequent.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Lentil soup',
      'Pasta with tomato sauce',
    ])
  },
}

/** A household that cooked nothing in the last 30 days sees its recipes alone. */
export const NothingCookedLately: Story = {
  args: { frequentMeals: [] },
}

/** A search with no match says so. */
export const NoMatch: Story = {
  play: async () => {
    const dialog = within(
      await within(document.body).findByRole('dialog', { name: 'Choose a recipe' }),
    )
    await userEvent.type(dialog.getByRole('searchbox', { name: 'Search recipes' }), 'zzzz')
    await expect(await dialog.findByText('No recipe matches "zzzz".')).toBeInTheDocument()
  },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/meals', ({ request }) =>
          new URL(request.url).searchParams.get('search')
            ? HttpResponse.json({ meals: [], hasMore: false, total: 0 })
            : undefined,
        ),
        ...defaultHandlers,
      ],
    },
  },
}
