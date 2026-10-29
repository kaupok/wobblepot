import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fridgePantryItems, fridgeRecentMeals } from '@/stories/fridge-fixtures'

import { FridgeMealPicker } from './FridgeMealPicker'

let recentFetches: number

beforeEach(() => {
  recentFetches = 0
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.startsWith('/api/entries/recent')) recentFetches += 1
      return Promise.resolve(
        new Response(JSON.stringify({ meals: fridgeRecentMeals, defaultServings: 2 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// A dinner skipped or planned between two opens must show on the second one,
// so the list cannot ride the app's 60 s staleTime (HON-1451).
describe('FridgeMealPicker reopen', () => {
  it('fetches the leftovers again when it opens a second time within a minute', async () => {
    // The app's own defaults (src/lib/get-query-client.ts), not the test wrapper's.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 60 * 1000, retry: false } },
    })
    const picker = (open: boolean) => (
      <QueryClientProvider client={queryClient}>
        <FridgeMealPicker
          open={open}
          onOpenChange={vi.fn()}
          planId="plan-1"
          date="2026-10-21"
          mealType="dinner"
          pantryItems={fridgePantryItems}
          onSaved={vi.fn()}
        />
      </QueryClientProvider>
    )
    const { rerender } = render(picker(true))
    const firstOpen = within(screen.getByRole('dialog', { name: 'Fridge meal' }))
    await firstOpen.findByRole('button', { name: 'Add: Mash, from Tuesday' })

    rerender(picker(false))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    rerender(picker(true))

    await waitFor(() => expect(recentFetches).toBe(2))
  })
})
