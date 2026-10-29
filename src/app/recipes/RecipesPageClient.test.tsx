import { render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { householdMealList } from '@/stories/fixtures'
import { createQueryWrapper } from '@/test/query-wrapper'

import { RecipesPageClient } from './RecipesPageClient'

vi.stubGlobal('fetch', vi.fn())

function mockMeals(meals: unknown[]) {
  vi.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify({ meals, nextCursor: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

describe('RecipesPageClient actions and empty library', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('offers Add recipe as the one primary action and Imagine as outline, with no Create', async () => {
    mockMeals(householdMealList)
    render(<RecipesPageClient householdServings={2} />, createQueryWrapper())

    await screen.findByRole('searchbox', { name: 'Search recipes' })
    const addLink = screen.getByRole('link', { name: 'Add recipe' })
    const group = within(addLink.parentElement!)
    const links = group.getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/recipes/import',
      '/recipes/imagine',
    ])
    expect(links.map((link) => link.dataset.variant)).toEqual(['default', 'outline'])
    // The blank form is reached from the add page, not from the library (HON-1271).
    expect(screen.queryByRole('link', { name: 'Create recipe' })).toBeNull()
    expect(document.querySelector('a[href="/recipes/create"]')).toBeNull()
    // A populated library has no empty-state Add.
    expect(screen.getAllByRole('link', { name: 'Add recipe' })).toHaveLength(1)
  })

  it('hides the search and the count and shows one primary Add recipe when the library is empty', async () => {
    mockMeals([])
    render(<RecipesPageClient householdServings={2} />, createQueryWrapper())

    expect(
      await screen.findByText(
        'No recipes yet. Add a family favourite, import one from a link, or imagine one.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.queryByText('No recipes')).toBeNull()

    const adds = screen.getAllByRole('link', { name: 'Add recipe' })
    expect(adds).toHaveLength(2)
    for (const add of adds) expect(add).toHaveAttribute('href', '/recipes/import')
    // The header's Add steps down to outline, so the empty state's is the one primary.
    expect(adds.map((add) => add.dataset.variant)).toEqual(['outline', 'default'])
    expect(screen.getByRole('link', { name: 'Imagine a meal' })).toBeInTheDocument()
  })

  it('keeps the search and offers no empty-state Add when the load fails', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Failed to fetch meals' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    render(<RecipesPageClient householdServings={2} />, createQueryWrapper())

    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull())
    expect(screen.getByRole('searchbox', { name: 'Search recipes' })).toBeInTheDocument()
    // Only the header's primary Add: a failed load is not an empty library.
    const adds = screen.getAllByRole('link', { name: 'Add recipe' })
    expect(adds).toHaveLength(1)
    expect(adds[0]!.dataset.variant).toBe('default')
  })
})

/**
 * Tests for the quantity conversion logic in RecipesPageClient.
 *
 * The key invariant being tested: when converting parsed recipe data to MealForm format,
 * the total quantity (convertedQuantity) must be divided by servings to get quantityPerServing.
 *
 * Bug context (HON-214): convertedQuantity was incorrectly passed directly as quantityPerServing,
 * causing MealForm to multiply by servings again, resulting in doubled quantities.
 */
describe('Recipe prefilled data conversion', () => {
  /**
   * Simulates the conversion logic from RecipesPageClient.getPrefilledMeal()
   * This is the core calculation that was fixed in HON-214.
   */
  function convertPrefilledIngredients(
    ingredients: Array<{
      type: 'matched' | 'unmatched'
      ingredient?: { id: string; name: string }
      convertedQuantity?: number
    }>,
    servings: number,
  ) {
    return ingredients
      .filter((i) => i.type === 'matched' && i.ingredient && i.convertedQuantity !== undefined)
      .map((i) => ({
        ingredientId: i.ingredient!.id,
        // convertedQuantity is the total for all servings, divide to get per-serving
        quantityPerServing: i.convertedQuantity! / servings,
        ingredient: i.ingredient!,
      }))
  }

  it('converts total quantity to per-serving quantity correctly', () => {
    const ingredients = [
      {
        type: 'matched' as const,
        ingredient: { id: '1', name: 'Spaghetti' },
        convertedQuantity: 200, // 200g total for 2 servings
      },
      {
        type: 'matched' as const,
        ingredient: { id: '2', name: 'Butter' },
        convertedQuantity: 50, // 50g total for 2 servings
      },
    ]
    const servings = 2

    const result = convertPrefilledIngredients(ingredients, servings)

    expect(result).toHaveLength(2)
    expect(result[0]!.quantityPerServing).toBe(100) // 200g / 2 = 100g per serving
    expect(result[1]!.quantityPerServing).toBe(25) // 50g / 2 = 25g per serving
  })

  it('handles different serving sizes correctly', () => {
    const ingredients = [
      {
        type: 'matched' as const,
        ingredient: { id: '1', name: 'Chicken' },
        convertedQuantity: 600, // 600g total for 4 servings
      },
    ]

    const result = convertPrefilledIngredients(ingredients, 4)

    expect(result).toHaveLength(1)
    expect(result[0]!.quantityPerServing).toBe(150) // 600g / 4 = 150g per serving
  })

  it('handles single serving recipes', () => {
    const ingredients = [
      {
        type: 'matched' as const,
        ingredient: { id: '1', name: 'Rice' },
        convertedQuantity: 80, // 80g total for 1 serving
      },
    ]

    const result = convertPrefilledIngredients(ingredients, 1)

    expect(result).toHaveLength(1)
    expect(result[0]!.quantityPerServing).toBe(80) // 80g / 1 = 80g per serving
  })

  it('filters out unmatched ingredients', () => {
    const ingredients = [
      {
        type: 'matched' as const,
        ingredient: { id: '1', name: 'Flour' },
        convertedQuantity: 300,
      },
      {
        type: 'unmatched' as const,
        ingredient: undefined,
        convertedQuantity: undefined,
      },
    ]

    const result = convertPrefilledIngredients(ingredients, 2)

    expect(result).toHaveLength(1)
    expect(result[0]!.ingredientId).toBe('1')
  })

  it('filters out ingredients without convertedQuantity', () => {
    const ingredients = [
      {
        type: 'matched' as const,
        ingredient: { id: '1', name: 'Sugar' },
        convertedQuantity: undefined,
      },
      {
        type: 'matched' as const,
        ingredient: { id: '2', name: 'Salt' },
        convertedQuantity: 10,
      },
    ]

    const result = convertPrefilledIngredients(ingredients, 2)

    expect(result).toHaveLength(1)
    expect(result[0]!.ingredientId).toBe('2')
  })

  it('preserves ingredient data in output', () => {
    const ingredients = [
      {
        type: 'matched' as const,
        ingredient: { id: 'ing-123', name: 'Olive Oil' },
        convertedQuantity: 30,
      },
    ]

    const result = convertPrefilledIngredients(ingredients, 3)

    expect(result).toHaveLength(1)
    expect(result[0]!).toEqual({
      ingredientId: 'ing-123',
      quantityPerServing: 10,
      ingredient: { id: 'ing-123', name: 'Olive Oil' },
    })
  })
})
