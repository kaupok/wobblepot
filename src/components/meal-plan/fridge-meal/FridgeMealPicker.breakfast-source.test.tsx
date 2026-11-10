import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fridgeItems, fridgePantryItems, fridgeRecentMeals } from '@/stories/fridge-fixtures'
import { createQueryWrapper } from '@/test/query-wrapper'

import { FridgeMealPicker } from './FridgeMealPicker'

let requests: { method: string; url: string; body: unknown }[]

beforeEach(() => {
  requests = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
      // The list holds no breakfast (HON-1524), so it does not hold the stored source.
      const body = url.startsWith('/api/entries/recent')
        ? { meals: fridgeRecentMeals, defaultServings: 2 }
        : { id: 'entry-1' }
      return Promise.resolve(
        new Response(JSON.stringify(body), {
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

// A breakfast link saved before HON-1524, or by `plan_fridge_meal`, stays valid.
describe('FridgeMealPicker with a stored breakfast source', () => {
  it('shows the breakfast item in Edit items and saves it back', async () => {
    const breakfastItem = {
      ...fridgeItems[0]!,
      id: 'item-oats',
      sourceEntryId: 'entry-oats',
      name: 'Overnight oats',
      sourceMealType: 'breakfast' as const,
      sourceState: 'completed' as const,
    }
    const onSaved = vi.fn()
    const { wrapper: Wrapper } = createQueryWrapper()
    render(
      <Wrapper>
        <FridgeMealPicker
          open
          onOpenChange={vi.fn()}
          planId="plan-1"
          entryId="entry-1"
          initialItems={[breakfastItem]}
          date="2026-10-21"
          mealType="lunch"
          pantryItems={fridgePantryItems}
          onSaved={onSaved}
        />
      </Wrapper>,
    )
    const dialog = within(screen.getByRole('dialog', { name: 'Fridge meal' }))
    const user = userEvent.setup()
    await dialog.findByRole('button', { name: 'Add: Lentil soup, from Monday' })

    const inMeal = within(dialog.getByRole('region', { name: 'In this meal' }))
    expect(inMeal.getByText('Overnight oats, from Tuesday')).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(requests.filter((r) => r.method !== 'GET')).toEqual([
      {
        method: 'PATCH',
        url: '/api/meal-plans/plan-1/entries/entry-1',
        body: { fridgeItems: [{ sourceEntryId: 'entry-oats' }] },
      },
    ])
  })
})
