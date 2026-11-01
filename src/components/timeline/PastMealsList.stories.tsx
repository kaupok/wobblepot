import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { MealType } from '@/generated/prisma/enums'
import type { Locale } from '@/lib/i18n/locales'
import { awaitDialogClosed } from '@/stories/a11y-helpers'
import {
  createExpectedMealTypes,
  createMeal,
  createPlanEntry,
  lemonGarlicChickenPantryItems,
  timelineTodayDate,
} from '@/stories/fixtures'
import { defaultHandlers } from '@/stories/msw-handlers'

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

// The Add on an empty dinner row: described by its slot, unlike the heading's.
const addTo = (canvasElement: HTMLElement, day: string) =>
  within(canvasElement).getByRole('button', { name: `Add to ${day}`, description: 'Dinner' })

// The day heading's Add, for the meal types the day does not expect (HON-1519).
const headingAddTo = (canvasElement: HTMLElement, day: string) =>
  within(
    within(canvasElement).getByRole('heading', { level: 2, name: day }).parentElement!,
  ).getByRole('button', { name: `Add to ${day}` })

export const NewestFirst: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The `/past-meals` list: yesterday first, because it is the day most likely to need marking. Each day is one `RowGroup` of rows, breakfast to dinner (HON-1018). A fridge meal is a row with its items as the name, and an expected meal with no entry is a row with Add (HON-1383). The heading\'s "+ Add" logs a meal type the day does not expect (HON-1519).',
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
 * saved as cooked in one request (HON-1383). Focus does not go back to Add:
 * the logged row takes it once the refresh lands (HON-1519).
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
    // The dialog is still animating open when findByRole resolves (HON-1493).
    await waitFor(() =>
      expect(within(dialog).getByRole('heading', { name: 'Cooked often lately' })).toBeVisible(),
    )

    await userEvent.click(within(dialog).getByRole('button', { name: 'Porridge with berries' }))
    await awaitDialogClosed(3000)
    await expect(add).not.toHaveFocus()
    await expect(logRequests).toEqual([
      { date: '2026-04-10', mealType: 'dinner', mealId: 'meal-porridge', status: 'completed' },
    ])
  },
}

/**
 * The heading's Add logs a meal type the day does not expect: each type is a
 * submenu of a recipe or a fridge meal, and the log is saved as cooked under
 * that type (HON-1519).
 */
export const LogAnotherMealType: Story = {
  parameters: LogARecipe.parameters,
  play: async ({ canvasElement }) => {
    logRequests.length = 0
    const body = within(document.body)

    await userEvent.click(headingAddTo(canvasElement, 'Friday Apr 10'))
    const menu = await body.findByRole('menu')
    await expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Breakfast', 'Lunch'])

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Breakfast' }))
    const submenu = await body.findByRole('menu', { name: 'Breakfast' })
    await userEvent.click(within(submenu).getByRole('menuitem', { name: 'Choose a recipe' }))
    const dialog = await body.findByRole('dialog', { name: 'Choose a recipe' })
    // The dialog is still animating open when findByRole resolves (HON-1493).
    await waitFor(() =>
      expect(within(dialog).getByRole('heading', { name: 'Cooked often lately' })).toBeVisible(),
    )

    await userEvent.click(within(dialog).getByRole('button', { name: 'Porridge with berries' }))
    await awaitDialogClosed(3000)
    await expect(logRequests).toEqual([
      { date: '2026-04-10', mealType: 'breakfast', mealId: 'meal-porridge', status: 'completed' },
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

/**
 * A narrow screen: "+ Add" wraps below the day heading, as on Today's day
 * card, rather than squeezing it (HON-1519).
 */
export const NarrowScreen: Story = {
  decorators: [
    (Story) => (
      <div className="w-44">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const heading = within(canvasElement).getByRole('heading', { level: 2, name: 'Friday Apr 10' })
    const add = headingAddTo(canvasElement, 'Friday Apr 10')
    await expect(add.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      heading.getBoundingClientRect().bottom,
    )
  },
}
