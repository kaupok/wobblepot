import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { pantryCheckRows } from '@/stories/pantry-check-fixtures'

import { renderSection } from './ShoppingSection.fixtures'

vi.stubGlobal('fetch', vi.fn())
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/shopping',
}))

afterEach(() => localStorage.clear())

describe('ShoppingSection — the check (HON-1585)', () => {
  it('renders the check above the first category group', async () => {
    localStorage.setItem('shopping-list-sort-mode', 'category')
    renderSection({ check: pantryCheckRows })

    const check = screen.getByRole('list', { name: 'Enough at home?' })
    await waitFor(() =>
      expect(screen.getAllByRole('heading', { level: 3 })[0]).toHaveAccessibleName(/Vegetable/),
    )
    const [firstGroup] = screen.getAllByRole('heading', { level: 3 })
    expect(
      check.compareDocumentPosition(firstGroup!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('renders the check above the first day group in the default sort', () => {
    renderSection({ check: pantryCheckRows })

    const check = screen.getByRole('list', { name: 'Enough at home?' })
    expect(within(check).getAllByRole('listitem')).toHaveLength(3)
    // The default sort groups by day; the check sits above the sort modes,
    // so it leads in each.
    const [firstGroup] = screen.getAllByRole('heading', { level: 3 })
    expect(firstGroup).toHaveAccessibleName('Today 3')
    expect(
      check.compareDocumentPosition(firstGroup!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('renders no check when it is empty', () => {
    renderSection({ check: [] })

    expect(screen.queryByText('Enough at home?')).not.toBeInTheDocument()
  })
})
