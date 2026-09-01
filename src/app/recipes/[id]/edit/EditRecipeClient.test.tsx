import type { ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { createQueryWrapper } from '@/test/query-wrapper'
import { EditRecipeClient } from './EditRecipeClient'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

// The form is exercised by its own suite; here it only has to prove that the
// loaded meal reached it.
vi.mock('@/components/household/MealForm', () => ({
  MealForm: ({ meal }: { meal?: { name: string } }) => (
    <div data-testid="meal-form">{meal?.name}</div>
  ),
}))

const mealResponse = {
  id: 'meal-1',
  name: 'Chicken and rice',
  description: 'Weeknight staple',
  preparationNotes: null,
  sourceUrl: null,
  timeMinutes: 30,
  kidFriendly: true,
  suitableFor: ['dinner'],
  servings: 4,
  components: [],
  // Fields the route returns but the form does not own.
  isFavorite: true,
  nutrition: { calories: 500, protein: 30, carbs: 40, fat: 20 },
}

const mockFetch = vi.fn()
global.fetch = mockFetch

function renderClient(props: Partial<ComponentProps<typeof EditRecipeClient>> = {}) {
  const { wrapper } = createQueryWrapper()
  return render(<EditRecipeClient mealId="meal-1" {...props} />, { wrapper })
}

describe('EditRecipeClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  it('renders neither the form nor an error while the meal is loading', () => {
    mockFetch.mockReturnValue(new Promise(() => {}))

    renderClient()

    // The spinner itself is a decorative icon with no accessible name (the
    // convention across the app), so the loading branch is identified by what
    // it does *not* render.
    expect(screen.queryByTestId('meal-form')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Back to recipes' })).not.toBeInTheDocument()
  })

  it('requests the meal by id and renders the form with the mapped data', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(mealResponse) })

    renderClient()

    expect(await screen.findByTestId('meal-form')).toHaveTextContent('Chicken and rice')
    expect(mockFetch).toHaveBeenCalledWith('/api/households/me/meals/meal-1', undefined)
  })

  it('keeps the spinner up while the fetch is paused offline', () => {
    // An offline mount leaves the query pending but *not* fetching, which must
    // not be mistaken for "no meal here".
    onlineManager.setOnline(false)
    try {
      mockFetch.mockReturnValue(new Promise(() => {}))

      renderClient()

      expect(screen.queryByText('Meal not found')).not.toBeInTheDocument()
      expect(screen.queryByText('Failed to load meal')).not.toBeInTheDocument()
      expect(screen.queryByTestId('meal-form')).not.toBeInTheDocument()
    } finally {
      onlineManager.setOnline(true)
    }
  })

  it('refetches on remount rather than serving a cached pre-save meal', async () => {
    // Mirrors `getQueryClient()`: without `gcTime: 0` the 60 s staleTime would
    // hand the re-opened page the meal as it looked before the last save, and
    // MealForm freezes whatever it is first handed.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 60_000, retry: false } },
    })
    function Wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(mealResponse) })

    const first = render(<EditRecipeClient mealId="meal-1" />, { wrapper: Wrapper })
    expect(await screen.findByTestId('meal-form')).toBeInTheDocument()
    first.unmount()
    // `gcTime: 0` drops the entry on a timer, which a real navigation always
    // outlasts; yield a macrotask so the test doesn't remount inside the tick.
    await new Promise((resolve) => setTimeout(resolve, 0))

    render(<EditRecipeClient mealId="meal-1" />, { wrapper: Wrapper })

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
  })

  it('shows the not-found copy for a 404', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'Meal not found' }),
    })

    renderClient()

    expect(await screen.findByText('Meal not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to recipes' })).toHaveAttribute(
      'href',
      '/recipes',
    )
    expect(screen.queryByTestId('meal-form')).not.toBeInTheDocument()
  })

  it('shows the generic failure copy for a non-404 client error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'Unauthorized' }),
    })

    renderClient()

    expect(await screen.findByText('Failed to load meal')).toBeInTheDocument()
    expect(screen.queryByText('Meal not found')).not.toBeInTheDocument()
  })

  it('retries a server error before showing the generic failure copy', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Boom' }),
    })

    renderClient()

    // Two retries with the default 1 s / 2 s backoff, so allow for the wait.
    expect(
      await screen.findByText('Failed to load meal', undefined, { timeout: 8000 }),
    ).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })
})
