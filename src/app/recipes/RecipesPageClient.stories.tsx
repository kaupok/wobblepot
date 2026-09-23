import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { dehydrate, HydrationBoundary, QueryClient, useQueryClient } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  emptyMealsHandlers,
  errorMealsHandlers,
  householdMeals,
  loadingMealsHandlers,
} from '@/stories/msw-handlers'
import { RecipesPageClient } from './RecipesPageClient'
import { mealsInitialPageParam, mealsQueryKey, type MealsPage } from './meals-query'

/** Records every `GET /api/households/me/meals` URL a story's handlers serve. */
const mealsRequest = fn()

/**
 * Cursor- and search-aware stand-in for the route: two meals per page, the
 * next page keyed by the last meal's id, `search` filtering by name.
 */
const paginatedMealsHandlers = [
  http.get('/api/households/me/meals', ({ request }) => {
    const url = new URL(request.url)
    mealsRequest(url.search)
    const search = url.searchParams.get('search')?.toLowerCase()
    const cursor = url.searchParams.get('cursor')
    const matching = search
      ? householdMeals.filter((meal) => meal.name.toLowerCase().includes(search))
      : householdMeals
    const start = cursor ? matching.findIndex((meal) => meal.id === cursor) + 1 : 0
    const meals = matching.slice(start, start + 2)
    const nextCursor = start + 2 < matching.length ? (meals.at(-1)?.id ?? null) : null
    return HttpResponse.json({ meals, nextCursor })
  }),
]

/**
 * Renders the story the way `page.tsx` does: inside a `HydrationBoundary`
 * holding the prefetched first page. The meals default mirrors the 60 s
 * `staleTime` of `getQueryClient`, which the preview's client lacks — without
 * it the hydrated page is stale on arrival and refetched on mount.
 */
function Prefetched({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  queryClient.setQueryDefaults(['meals'], { staleTime: 60 * 1000 })
  const [state] = useState(() => {
    const server = new QueryClient()
    // The MSW fixture types enums as plain strings; it is the same JSON the
    // handlers serve, so the cast only narrows those strings.
    const firstPage: MealsPage = {
      meals: householdMeals.slice(0, 2) as unknown as MealsPage['meals'],
      nextCursor: 'meal-salmon',
    }
    server.setQueryData(mealsQueryKey(undefined), {
      pages: [firstPage],
      pageParams: [mealsInitialPageParam],
    })
    return dehydrate(server)
  })
  return <HydrationBoundary state={state}>{children}</HydrationBoundary>
}

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

export const Loading: Story = {
  parameters: {
    msw: { handlers: loadingMealsHandlers },
    docs: {
      description: {
        story:
          'Request never resolves — the list area draws `RecipesGridSkeleton`, the same grid `loading.tsx` shows, not a spinner (HON-770).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Loading…')).toBeVisible()
    await expect(canvasElement.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    await expect(canvasElement.querySelector('.animate-spin')).toBeNull()
  },
}

// The server prefetch path: the first page arrives hydrated, so the client
// renders it without requesting it, then continues from its cursor and
// refetches under a new key when the search changes (HON-770).
export const PrefetchedThenSearchAndLoadMore: Story = {
  name: 'Prefetched, then load more and search',
  decorators: [
    (Story) => (
      <Prefetched>
        <Story />
      </Prefetched>
    ),
  ],
  parameters: {
    msw: { handlers: paginatedMealsHandlers },
    docs: {
      description: {
        story:
          'First page hydrated from the server prefetch. **Load more** fetches page two by `cursor`; typing a search changes the query key and fetches `?search=`.',
      },
    },
  },
  beforeEach: () => {
    mealsRequest.mockClear()
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    // Hydrated: the first page renders with no request for it.
    await expect(canvas.getByText('Lemon-garlic roast chicken')).toBeVisible()
    await expect(canvas.getByText('Miso-glazed salmon with rice')).toBeVisible()
    await expect(canvas.queryByText('Spiced red-lentil stew')).toBeNull()
    await expect(mealsRequest).not.toHaveBeenCalled()

    // Infinite scroll continues from the hydrated page's cursor.
    await userEvent.click(canvas.getByRole('button', { name: 'Load more' }))
    await expect(await canvas.findByText('Spiced red-lentil stew')).toBeVisible()
    await expect(mealsRequest).toHaveBeenCalledWith('?cursor=meal-salmon')
    await waitFor(() => expect(canvas.queryByRole('button', { name: 'Load more' })).toBeNull())

    // A search is a new key: fetched from the route, not the hydrated cache.
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search recipes' }), 'lentil')
    await waitFor(() => expect(mealsRequest).toHaveBeenCalledWith('?search=lentil'))
    await waitFor(() => expect(canvas.queryByText('Lemon-garlic roast chicken')).toBeNull())
    await expect(canvas.getByText('Spiced red-lentil stew')).toBeVisible()
  },
}
