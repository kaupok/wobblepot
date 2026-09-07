import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InventoryPage } from './InventoryPage'
import { WINDOW_STORAGE_KEY } from './use-shopping-window'
import { createQueryWrapper } from '@/test/query-wrapper'

const routerPush = vi.fn()
const routerReplace = vi.fn()
const routerRefresh = vi.fn()

// A stable router object, not a fresh one per call: `useWindowReconcile` keys
// its effect on the router identity.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace, refresh: routerRefresh }),
}))

vi.stubGlobal('fetch', vi.fn())

beforeEach(() => {
  localStorage.clear()
  routerPush.mockClear()
  routerReplace.mockClear()
  routerRefresh.mockClear()
})

function renderPage(overrides: Partial<Parameters<typeof InventoryPage>[0]> = {}) {
  const { wrapper } = createQueryWrapper()
  return render(<InventoryPage pantryItems={[]} shoppingData={null} {...overrides} />, { wrapper })
}

/**
 * The window reconcile lives here rather than in `ShoppingListHeader` because
 * this is the one component on every `/shopping` visit that renders exactly
 * once. That placement is what these tests pin: the header-less states get the
 * reconcile too, and it can never fire twice.
 */
describe('InventoryPage window reconcile', () => {
  it('applies a stored 14-day preference over a 7-day render', () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, '14')

    renderPage({ emptyStateVariant: 'nothing-needed', windowDays: 7 })

    expect(routerReplace).toHaveBeenCalledWith('/shopping?days=14')
  })

  it('applies it on the populated list too — the regression HON-624 closes', () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, '14')

    renderPage({
      windowDays: 7,
      shoppingData: {
        windowDays: 7,
        startDate: '2026-02-16',
        endDate: '2026-02-23',
        groups: [],
        initialPurchasedIds: new Set<string>(),
      },
    })

    expect(routerReplace).toHaveBeenCalledWith('/shopping?days=14')
  })

  // `no-plan` renders no header and so no picker, which the AC requires. It
  // still has to honour the saved window: the narrow window is itself one of
  // the reasons this state appears, since `generatedAt` is folded over plan
  // entries already filtered to the window. Without the reconcile the user is
  // told "No meal plan yet" about a plan they have, with no control to fix it.
  it('applies it on `no-plan`, which has no picker to recover with', () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, '14')

    renderPage({ emptyStateVariant: 'no-plan', windowDays: 7 })

    expect(screen.queryByRole('combobox', { name: 'Time window' })).not.toBeInTheDocument()
    expect(routerReplace).toHaveBeenCalledWith('/shopping?days=14')
  })

  it('applies it on `error` as well', () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, '14')

    renderPage({ emptyStateVariant: 'error', windowDays: 7 })

    expect(routerReplace).toHaveBeenCalledWith('/shopping?days=14')
  })

  it('fires once, not once per rendered header', () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, '14')

    renderPage({ emptyStateVariant: 'nothing-needed', windowDays: 7 })

    expect(routerReplace).toHaveBeenCalledTimes(1)
  })

  it('leaves the URL alone when the stored window already matches', () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, '7')

    renderPage({ emptyStateVariant: 'nothing-needed', windowDays: 7 })

    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('leaves the URL alone when there is no stored preference', () => {
    renderPage({ emptyStateVariant: 'nothing-needed', windowDays: 14 })

    expect(routerReplace).not.toHaveBeenCalled()
  })

  // An explicit `?days=` is the user's immediate intent. Overriding it makes
  // Back a no-op right after using the picker, and a shared 14-day link
  // unopenable for anyone who has ever chosen 7 days.
  it('leaves an explicit URL alone even when the stored window disagrees', () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, '14')

    renderPage({ emptyStateVariant: 'nothing-needed', windowDays: 7, windowDaysFromUrl: true })

    expect(routerReplace).not.toHaveBeenCalled()
  })
})
