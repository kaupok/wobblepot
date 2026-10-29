import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, within } from 'storybook/test'

import { RecentlyDeletedMeals } from './RecentlyDeletedMeals'

const deleted = [
  { id: 'meal-curry', name: 'Chicken curry', deletedAt: '2026-10-24T09:00:00.000Z' },
  { id: 'meal-soup', name: 'Rice soup', deletedAt: '2026-10-02T09:00:00.000Z' },
]

const meta = {
  title: 'Feature/Household/RecentlyDeletedMeals',
  component: RecentlyDeletedMeals,
  parameters: {
    layout: 'padded',
    msw: {
      handlers: [
        http.get('/api/households/me/meals/deleted', () => HttpResponse.json({ meals: deleted })),
      ],
    },
    docs: {
      description: {
        component:
          'The end of the Recipes list: recipes deleted in the last 30 days, closed until opened, each with the day it was deleted and a Restore button (HON-1336). `MealList` renders it and owns the restore request. Renders nothing when no recipe was deleted.',
      },
    },
  },
  args: { onRestore: fn(), restoringId: null },
} satisfies Meta<typeof RecentlyDeletedMeals>

export default meta
type Story = StoryObj<typeof meta>

export const Collapsed: Story = {
  play: async ({ canvasElement }) => {
    const trigger = await within(canvasElement).findByRole('button', {
      name: 'Recently deleted (2)',
    })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  },
}

export const Open: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Recently deleted (2)' }))
    await expect(canvas.getByText('Deleted Oct 24')).toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: 'Restore: Rice soup' }))

    await expect(args.onRestore).toHaveBeenCalledWith('meal-soup', false)
  },
}

/** A restore in flight: every Restore is `aria-disabled` but keeps focus. */
export const Restoring: Story = {
  args: { restoringId: 'meal-curry' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Recently deleted (2)' }))
    await expect(canvas.getByRole('button', { name: 'Restore: Rice soup' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  },
}

export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/households/me/meals/deleted', () => HttpResponse.json({ meals: [] })),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await new Promise((resolve) => setTimeout(resolve, 400))
    await expect(within(canvasElement).queryByRole('button')).toBeNull()
  },
}
