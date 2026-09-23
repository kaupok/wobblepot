import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { emptyMealsHandlers, errorMealsHandlers } from '@/stories/msw-handlers'
import { RecipesPageClient } from './RecipesPageClient'

const meta = {
  title: 'Feature/RecipesPageClient',
  component: RecipesPageClient,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Household recipes page. Fetches `/api/households/me/meals` via `useInfiniteQuery`. MSW handlers in `src/stories/msw-handlers.ts` serve fixture data by default.',
      },
    },
  },
} satisfies Meta<typeof RecipesPageClient>

export default meta
type Story = StoryObj<typeof meta>

// The title is the page's h1 on the background, not a card header, and no
// card wraps the meal cards (HON-747).
export const Populated: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { level: 1, name: 'My recipes' })).toBeVisible()
    await canvas.findAllByRole('button', { name: /delete meal/i })
    const cards = canvasElement.querySelectorAll('[data-slot="card"]')
    await expect(cards.length).toBeGreaterThan(0)
    for (const card of cards) {
      await expect(card.parentElement?.closest('[data-slot="card"]')).toBeNull()
    }
  },
}

export const Empty: Story = {
  parameters: {
    msw: { handlers: emptyMealsHandlers },
    docs: {
      description: {
        story:
          'Endpoint returns `{ meals: [], nextCursor: null }` — `MealList` renders its empty state.',
      },
    },
  },
}

export const ErrorState: Story = {
  name: 'Error',
  parameters: {
    msw: { handlers: errorMealsHandlers },
    docs: {
      description: {
        story:
          'Endpoint returns a 500 — `useInfiniteQuery` surfaces no data; the page falls through to the empty-list state.',
      },
    },
  },
}
