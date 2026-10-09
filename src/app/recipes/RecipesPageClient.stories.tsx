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
    await canvas.findAllByRole('button', { name: /^More actions: / })
    const cards = canvasElement.querySelectorAll('[data-slot="card"]')
    await expect(cards.length).toBeGreaterThan(0)
    for (const card of cards) {
      await expect(card.parentElement?.closest('[data-slot="card"]')).toBeNull()
    }
    await expectPhoneActions(canvasElement)
  },
}

const ACTION_HREFS = ['/recipes/import', '/recipes/create', '/recipes/imagine']

/** The Import, Create and Imagine links of the actions group, in DOM order. */
function actionLinks(canvasElement: HTMLElement) {
  const group = canvasElement.querySelector<HTMLAnchorElement>(
    'a[href="/recipes/import"]',
  )!.parentElement!
  return ACTION_HREFS.map((href) => group.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)!)
}

/**
 * Import is the one primary; Create and Imagine are outline (HON-1128). On a
 * phone Import runs the width on its own row and the other two are two-up
 * under it, so the three never sit as equal buttons in one row. No label
 * overflows its button (HON-812).
 */
async function expectPhoneActions(canvasElement: HTMLElement) {
  const links = actionLinks(canvasElement)
  await expect(links.map((link) => link.dataset.variant)).toEqual(['default', 'outline', 'outline'])
  const [importLink, create, imagine] = links.map((link) => link.getBoundingClientRect())
  const row = links[0]!.parentElement!.getBoundingClientRect()
  await expect(importLink!.left).toBeCloseTo(row.left, 0)
  await expect(importLink!.right).toBeCloseTo(row.right, 0)
  await expect(create!.top).toBeGreaterThan(importLink!.bottom)
  await expect(create!.top).toBe(imagine!.top)
  await expect(create!.left).toBeCloseTo(row.left, 0)
  await expect(imagine!.right).toBeCloseTo(row.right, 0)
  for (const link of links) {
    await expect(link.scrollWidth).toBeLessThanOrEqual(link.clientWidth)
  }
}

export const PhoneEstonian: Story = {
  name: 'Phone, Estonian',
  globals: { locale: 'et' },
  parameters: {
    docs: {
      description: {
        story:
          'The longer Estonian labels still fit: Import on its own row, Create and Imagine two-up under it at 390px (HON-812, HON-1128).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findAllByRole('button', { name: /^Rohkem toiminguid: / })
    await expectPhoneActions(canvasElement)
  },
}

export const Desktop: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  parameters: {
    docs: {
      description: {
        story:
          'From `sm` the search and the three actions share a row, and the actions are as wide as their labels at its end (HON-812, HON-1128).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const search = (await within(canvasElement).findByRole('searchbox')).getBoundingClientRect()
    const links = actionLinks(canvasElement)
    const actions = links[0]!.parentElement!
    const outer = actions.parentElement!.getBoundingClientRect()
    // Label-sized: the three take only their labels' room, after the search,
    // on the search's line and flush with the end of the row.
    await expect(actions.getBoundingClientRect().left).toBeGreaterThan(search.right)
    await expect(actions.getBoundingClientRect().right).toBeCloseTo(outer.right, 0)
    for (const link of links) {
      await expect(link.getBoundingClientRect().top).toBeCloseTo(search.top, 0)
    }
  },
}

/**
 * Empty library: nothing to search and nothing to count, so the search field
 * and the count are gone. The empty state is one line and one primary
 * "Create recipe"; the three header actions stay above it (HON-1128).
 */
export const Empty: Story = {
  name: 'Empty library',
  parameters: {
    msw: { handlers: emptyMealsHandlers },
    docs: {
      description: {
        story:
          'Endpoint returns `{ meals: [], nextCursor: null }`. No search field and no count; `MealList` renders its empty state with a primary **Create recipe** (HON-1128).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText(
        'No recipes yet. Add a family favourite, import one from a link, or imagine one.',
      ),
    ).toBeVisible()
    await expect(canvas.queryByRole('searchbox')).toBeNull()
    await expect(canvas.queryByText('No recipes')).toBeNull()
    await expect(canvas.queryByText('Loading…')).toBeNull()

    // The header's outline Create, then the empty state's primary one.
    const creates = canvas.getAllByRole('link', { name: 'Create recipe' })
    await expect(creates).toHaveLength(2)
    await expect(creates.map((link) => link.dataset.variant)).toEqual(['outline', 'default'])
    for (const link of creates) await expect(link).toHaveAttribute('href', '/recipes/create')
    // A page-level button runs the column's width on a phone.
    const column = creates[1]!.parentElement!.getBoundingClientRect()
    await expect(creates[1]!.getBoundingClientRect().width).toBeCloseTo(column.width, 0)
    await expectPhoneActions(canvasElement)
  },
}

/**
 * Deleting the last recipe empties the library, which unmounts the search
 * field `MealList` would return focus to. Focus lands on the empty state's
 * Create button instead of the page body.
 */
export const LastDeleteFocusesCreate: Story = {
  name: 'Last delete focuses Create',
  parameters: {
    msw: {
      handlers: [
        http.get('/api/households/me/meals', ({ request }) => {
          mealsRequest(new URL(request.url).search)
          return HttpResponse.json({ meals: householdMeals.slice(0, 1), nextCursor: null })
        }),
        http.delete('/api/households/me/meals/:id', () => HttpResponse.json({ ok: true })),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await deleteOnlyRecipe(canvasElement)

    await waitFor(() => expect(canvas.queryByRole('searchbox')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(emptyStateCreate(canvasElement)))
  },
}

/**
 * The other way the search unmounts: it holds the caret. Search for the only
 * recipe, delete it, then clear the field. Once the debounce settles the
 * library is empty and the search goes, and focus moves to Create rather than
 * dropping to the page body.
 */
export const ClearedSearchFocusesCreate: Story = {
  name: 'Cleared search focuses Create',
  parameters: LastDeleteFocusesCreate.parameters,
  beforeEach: () => {
    mealsRequest.mockClear()
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const search = await canvas.findByRole('searchbox', { name: 'Search recipes' })
    await userEvent.type(search, 'lemon')
    // The debounced search has run and its results are on the page.
    await waitFor(() => expect(mealsRequest).toHaveBeenCalledWith('?search=lemon'))
    await canvas.findByRole('button', { name: /^More actions: / })
    await deleteOnlyRecipe(canvasElement)
    await waitFor(() => expect(document.activeElement).toBe(search))

    await userEvent.clear(search)
    await waitFor(() => expect(canvas.queryByRole('searchbox')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(emptyStateCreate(canvasElement)))
  },
}

async function deleteOnlyRecipe(canvasElement: HTMLElement) {
  const body = within(document.body)
  await userEvent.click(
    await within(canvasElement).findByRole('button', { name: /^More actions: / }),
  )
  await userEvent.click(await body.findByRole('menuitem', { name: 'Delete' }))
  const dialog = await body.findByRole('alertdialog')
  await userEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }))
}

/** The empty state's primary Create, queried fresh: it mounts with the empty library. */
function emptyStateCreate(canvasElement: HTMLElement) {
  return within(canvasElement)
    .getAllByRole('link', { name: 'Create recipe', hidden: true })
    .find((link) => link.dataset.variant === 'default')
}

export const ErrorState: Story = {
  name: 'Error',
  parameters: {
    msw: { handlers: errorMealsHandlers },
    docs: {
      description: {
        story:
          'Endpoint returns a 500 — `useInfiniteQuery` surfaces no data. The search stays and the empty state offers no Create: a failed load is not an empty library (HON-1128).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.queryByText('Loading…')).toBeNull())
    await expect(canvas.getByRole('searchbox', { name: 'Search recipes' })).toBeVisible()
    await expect(canvas.getAllByRole('link', { name: 'Create recipe' })).toHaveLength(1)
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
