import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '@/test/query-wrapper'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))

import { apiFetch } from '@/lib/api'
import { useMealAlternatives, type UseMealAlternativesOptions } from './use-meal-alternatives'

const mockApiFetch = vi.mocked(apiFetch)

function libraryMeal(id: string, name: string) {
  return {
    id,
    name,
    description: null,
    timeMinutes: 30,
    kidFriendly: true,
    primaryProteinType: 'poultry',
    suitableFor: ['dinner'],
    components: [],
    nutrition: { calories: 400, protein: 20, carbs: 40, fat: 12 },
  }
}

function page(ids: string[], { hasMore = false, total = ids.length } = {}) {
  return { meals: ids.map((id) => libraryMeal(id, `Meal ${id}`)), hasMore, total }
}

const baseOptions: UseMealAlternativesOptions = {
  open: true,
  planId: 'plan-1',
  entryId: 'entry-1',
  mealType: 'dinner',
  mode: 'swap',
  search: '',
  myRecipesOnly: false,
}

function render(overrides: Partial<UseMealAlternativesOptions> = {}) {
  const { wrapper } = createQueryWrapper()
  return renderHook(() => useMealAlternatives({ ...baseOptions, ...overrides }), { wrapper })
}

/** Last path passed to `apiFetch`, for asserting query-string construction. */
function lastUrl() {
  return mockApiFetch.mock.calls.at(-1)?.[0] as string
}

describe('useMealAlternatives', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('suggestions mode', () => {
    it('posts to the regenerate endpoint in swap mode and returns alternatives', async () => {
      mockApiFetch.mockResolvedValueOnce({ alternatives: [libraryMeal('a', 'Alt A')] })

      const { result } = render()

      await waitFor(() => expect(result.current.isLoading).toBe(false))
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/meal-plans/plan-1/entries/entry-1/regenerate',
        { method: 'POST' },
      )
      expect(result.current.displayedMeals.map((m) => m.id)).toEqual(['a'])
      expect(result.current.isSearchMode).toBe(false)
      expect(result.current.isMyRecipesBrowseMode).toBe(false)
    })

    it('posts to the suggestions endpoint in add mode', async () => {
      mockApiFetch.mockResolvedValueOnce({ suggestions: [] })

      const { result } = render({ mode: 'add' })

      await waitFor(() => expect(result.current.isLoading).toBe(false))
      expect(lastUrl()).toBe('/api/meal-plans/plan-1/entries/entry-1/suggestions')
    })

    it('never paginates — hasMore stays false and total stays 0', async () => {
      mockApiFetch.mockResolvedValueOnce({ alternatives: [libraryMeal('a', 'Alt A')] })

      const { result } = render()

      await waitFor(() => expect(result.current.isLoading).toBe(false))
      expect(result.current.hasMore).toBe(false)
      expect(result.current.total).toBe(0)
      expect(result.current.hasLoadedList).toBe(false)
    })

    it('fetches nothing while the modal is closed', () => {
      render({ open: false })
      expect(mockApiFetch).not.toHaveBeenCalled()
    })
  })

  describe('search mode', () => {
    it('switches to the meals endpoint once a search term is set', async () => {
      mockApiFetch.mockResolvedValueOnce(page(['s1', 's2'], { total: 7 }))

      const { result } = render({ search: '  chicken  ' })

      await waitFor(() => expect(result.current.isLoading).toBe(false))
      expect(result.current.isSearchMode).toBe(true)
      expect(result.current.displayedMeals.map((m) => m.id)).toEqual(['s1', 's2'])
      expect(result.current.total).toBe(7)
      expect(result.current.hasLoadedList).toBe(true)

      const url = new URL(lastUrl(), 'https://example.test')
      expect(url.pathname).toBe('/api/meals')
      // Whitespace is trimmed before it reaches the query string.
      expect(url.searchParams.get('search')).toBe('chicken')
      expect(url.searchParams.get('mealType')).toBe('dinner')
      expect(url.searchParams.get('offset')).toBe('0')
      expect(url.searchParams.get('source')).toBeNull()
    })

    it('adds source=custom when the my-recipes filter is on', async () => {
      mockApiFetch.mockResolvedValueOnce(page(['s1']))

      const { result } = render({ search: 'chicken', myRecipesOnly: true })

      await waitFor(() => expect(result.current.isLoading).toBe(false))
      // Search wins over browse when both could apply.
      expect(result.current.isMyRecipesBrowseMode).toBe(false)
      expect(new URL(lastUrl(), 'https://example.test').searchParams.get('source')).toBe('custom')
    })

    it('appends the next page at an offset past the loaded results', async () => {
      mockApiFetch
        .mockResolvedValueOnce(page(['s1', 's2'], { hasMore: true, total: 3 }))
        .mockResolvedValueOnce(page(['s3'], { hasMore: false, total: 3 }))

      const { result } = render({ search: 'chicken' })

      await waitFor(() => expect(result.current.hasMore).toBe(true))

      result.current.loadMore()

      await waitFor(() => expect(result.current.displayedMeals).toHaveLength(3))
      expect(result.current.displayedMeals.map((m) => m.id)).toEqual(['s1', 's2', 's3'])
      expect(new URL(lastUrl(), 'https://example.test').searchParams.get('offset')).toBe('2')
      // Last page reported hasMore: false, so the button should disappear.
      expect(result.current.hasMore).toBe(false)
    })

    it('refetches from offset 0 when the search term changes', async () => {
      mockApiFetch
        .mockResolvedValueOnce(page(['s1'], { hasMore: true }))
        .mockResolvedValueOnce(page(['t1']))

      const { result, rerender } = renderHook(
        (props: { search: string }) =>
          useMealAlternatives({ ...baseOptions, search: props.search }),
        { wrapper: createQueryWrapper().wrapper, initialProps: { search: 'chicken' } },
      )

      await waitFor(() => expect(result.current.displayedMeals).toHaveLength(1))

      rerender({ search: 'tofu' })

      await waitFor(() => expect(result.current.displayedMeals.map((m) => m.id)).toEqual(['t1']))
      expect(new URL(lastUrl(), 'https://example.test').searchParams.get('offset')).toBe('0')
    })
  })

  describe('my-recipes browse mode', () => {
    it('browses custom recipes when the filter is on with no search term', async () => {
      mockApiFetch.mockResolvedValueOnce(page(['c1'], { total: 1 }))

      const { result } = render({ myRecipesOnly: true })

      await waitFor(() => expect(result.current.isLoading).toBe(false))
      expect(result.current.isMyRecipesBrowseMode).toBe(true)
      expect(result.current.displayedMeals.map((m) => m.id)).toEqual(['c1'])

      const params = new URL(lastUrl(), 'https://example.test').searchParams
      expect(params.get('source')).toBe('custom')
      expect(params.get('search')).toBeNull()
    })
  })
})
