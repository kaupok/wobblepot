import type { Meta, StoryObj } from '@storybook/nextjs-vite'
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

export const Populated: Story = {}

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
