import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { MealType } from '@/generated/prisma/enums'
import {
  createExpectedMealTypes,
  createMeal,
  createPlanEntry,
  lemonGarlicChickenPantryItems,
  timelineTodayDate,
} from '@/stories/fixtures'
import { awaitDialogClosed } from '@/stories/a11y-helpers'
import { defaultHandlers } from '@/stories/msw-handlers'
import type { Locale } from '@/lib/i18n/locales'
import { buildPastDays } from './past-days'
import { PastMealsList } from './PastMealsList'

const entries = [
  createPlanEntry({
    id: 'e-past-3',
    date: '2026-04-11',
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
  // A quick night: a planned fridge meal with the household's own words.
  createPlanEntry({
    id: 'e-past-fridge',
    date: '2026-04-12',
    mealType: MealType.dinner,
    meal: null,
    kind: 'fridge',
    items: [
      {
        id: 'item-wolt',
        ingredientId: null,
        sourceEntryId: null,
        label: 'Wolt',
        name: null,
        sourceDate: null,
        servings: null,
      },
    ],
  }),
]

/** Wednesday 15 April 2026 is today; the range reaches back to Saturday the 11th. */
const days = (locale: Locale = 'en') =>
  buildPastDays(entries, {
    startDate: '2026-04-10',
    todayDate: timelineTodayDate,
    expectedMealTypes: createExpectedMealTypes(),
    locale,
  })

const meta = {
  title: 'Feature/Timeline/PastMealsList',
  component: PastMealsList,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    days: days(),
    planId: 'plan-1',
    householdServings: 4,
    pantryItems: lemonGarlicChickenPantryItems,
    log: {
      frequentMeals: [{ id: 'meal-porridge', name: 'Porridge with berries' }],
      recentLabels: ['Wolt', 'pelmeenid'],
    },
    weeks: 1,
    hasEarlierWeek: true,
  },
} satisfies Meta<typeof PastMealsList>

export default meta
type Story = StoryObj<typeof meta>

const addTo = (canvasElement: HTMLElement, day: string) =>
  within(canvasElement).getByRole('button', { name: `Add to ${day}` })

export const NewestFirst: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The `/past-meals` list: yesterday first, because it is the day most likely to need marking. Each day is one `RowGroup` of rows, breakfast to dinner (HON-1018). A fridge meal is a row with its items as the name, and an expected meal with no entry is a row with Add (HON-1383).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const headings = canvas.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    await expect(headings).toEqual([
      'Tuesday Apr 14',
      'Monday Apr 13',
      'Sunday Apr 12',
      'Saturday Apr 11',
      'Friday Apr 10',
    ])

    // One box per day, one row per meal; the note-only lunch has no row.
    const groups = canvasElement.querySelectorAll<HTMLElement>('[data-slot="row-group"]')
    await expect(groups).toHaveLength(5)
    await expect(within(groups[0]!).getAllByRole('button', { name: 'Cooked' })).toHaveLength(2)
    await expect(groups[0]).toHaveTextContent(/Breakfast.*Porridge with berries.*Dinner/)
    await expect(canvasElement).not.toHaveTextContent('Eating out')
    await expect(groups[2]).toHaveTextContent('Wolt')
    // Friday has no entry: its expected dinner is a row with Add.
    await expect(addTo(canvasElement, 'Friday Apr 10')).toHaveAccessibleDescription('Dinner')
    // No image and no description on a row.
    await expect(canvas.queryByRole('img')).not.toBeInTheDocument()
  },
}

/**
 * Add on an empty slot offers a recipe or a fridge meal only: the household
 * already ate, so Pick for me, Generate and Extra are not there. A recipe is
 * saved as cooked in one request, and focus returns to Add when the picker
 * closes (HON-1383).
 */
const logRequests: unknown[] = []

export const LogARecipe: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post('/api/meal-plans/:planId/entries', async ({ request }) => {
          logRequests.push(await request.json())
          return HttpResponse.json({ id: 'logged' })
        }),
        ...defaultHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    logRequests.length = 0
    const body = within(document.body)
    const add = addTo(canvasElement, 'Friday Apr 10')

    await userEvent.click(add)
    const menu = await body.findByRole('menu')
    await expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Choose a recipe', 'Fridge meal'])

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Choose a recipe' }))
    const dialog = await body.findByRole('dialog', { name: 'Choose a recipe' })
    await expect(within(dialog).getByRole('heading', { name: 'Cooked often lately' })).toBeVisible()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Porridge with berries' }))
    await awaitDialogClosed(3000)
    await waitFor(() => expect(add).toHaveFocus())
    await expect(logRequests).toEqual([
      { date: '2026-04-10', mealType: 'dinner', mealId: 'meal-porridge', status: 'completed' },
    ])
  },
}

/** The first week before the household was created: no "Show the week before". */
export const NoEarlierWeek: Story = {
  args: { hasEarlierWeek: false },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole('button', { name: 'Show the week before' }),
    ).not.toBeInTheDocument()
  },
}

/** The longest labels, "Vahele jäetud" among them, fit their buttons. */
export const Estonian: Story = {
  args: { days: days('et') },
  globals: { locale: 'et' },
}
