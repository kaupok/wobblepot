import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiFetch: vi.fn(),
}))

import { apiFetch } from '@/lib/api'
import {
  RecentlyDeletedMeals,
  recentlyDeletedMealsQueryKey,
  type DeletedMeal,
} from './RecentlyDeletedMeals'

const mockApiFetch = vi.mocked(apiFetch)

const CURRY: DeletedMeal = {
  id: 'meal-curry',
  name: 'Chicken curry',
  deletedAt: '2026-10-25T08:00:00.000Z',
}
const SOUP: DeletedMeal = {
  id: 'meal-soup',
  name: 'Rice soup',
  deletedAt: '2026-10-20T08:00:00.000Z',
}

function setup(meals: DeletedMeal[], restoringId: string | null = null) {
  mockApiFetch.mockResolvedValue({ meals })
  const onRestore = vi.fn()
  const { wrapper, queryClient } = createQueryWrapper()
  const view = render(<RecentlyDeletedMeals onRestore={onRestore} restoringId={restoringId} />, {
    wrapper,
  })
  return { ...view, onRestore, queryClient }
}

async function open() {
  await userEvent.click(await screen.findByRole('button', { name: /Recently deleted/ }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RecentlyDeletedMeals', () => {
  it('renders nothing when no recipe was deleted in the last 30 days', async () => {
    const { container } = setup([])

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/api/households/me/meals/deleted'),
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('starts collapsed, with the count on its trigger', async () => {
    setup([CURRY, SOUP])

    const trigger = await screen.findByRole('button', { name: 'Recently deleted (2)' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Chicken curry')).toBeNull()
  })

  it('lists each recipe with the day it was deleted and a Restore button', async () => {
    setup([CURRY, SOUP])

    await open()

    expect(screen.getByText('Chicken curry')).toBeVisible()
    expect(screen.getByText('Deleted Oct 25')).toBeVisible()
    expect(screen.getByText('Rice soup')).toBeVisible()
    expect(screen.getByText('Deleted Oct 20')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Restore: Chicken curry' })).toBeVisible()
  })

  it('restores a row that has a neighbour without asking the list for focus', async () => {
    const { onRestore } = setup([CURRY, SOUP])
    await open()

    await userEvent.click(screen.getByRole('button', { name: 'Restore: Rice soup' }))

    expect(onRestore).toHaveBeenCalledWith('meal-soup', false)
  })

  it('asks the list to focus the restored card when the row is the only one', async () => {
    const { onRestore } = setup([CURRY])
    await open()

    await userEvent.click(screen.getByRole('button', { name: 'Restore: Chicken curry' }))

    expect(onRestore).toHaveBeenCalledWith('meal-curry', true)
  })

  it('ignores a second Restore while one is in flight, and keeps the button focusable', async () => {
    const { onRestore } = setup([CURRY, SOUP], 'meal-curry')
    await open()

    const button = screen.getByRole('button', { name: 'Restore: Rice soup' })
    await userEvent.click(button)

    expect(onRestore).not.toHaveBeenCalled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
  })

  it("moves focus to the next row's Restore once the restored row leaves", async () => {
    const { onRestore, rerender, queryClient } = setup([CURRY, SOUP])
    await open()
    const curryButton = screen.getByRole('button', { name: 'Restore: Chicken curry' })
    await userEvent.click(curryButton)
    expect(onRestore).toHaveBeenCalledWith('meal-curry', false)

    rerender(<RecentlyDeletedMeals onRestore={onRestore} restoringId="meal-curry" />)
    act(() => {
      queryClient.setQueryData(recentlyDeletedMealsQueryKey, { meals: [SOUP] })
    })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Restore: Rice soup' })).toHaveFocus(),
    )
  })

  it('keeps focus on Restore when the restore fails', async () => {
    const { onRestore, rerender } = setup([CURRY, SOUP])
    await open()
    const curryButton = screen.getByRole('button', { name: 'Restore: Chicken curry' })
    await userEvent.click(curryButton)

    rerender(<RecentlyDeletedMeals onRestore={onRestore} restoringId="meal-curry" />)
    rerender(<RecentlyDeletedMeals onRestore={onRestore} restoringId={null} />)

    expect(curryButton).toHaveFocus()
  })
})
