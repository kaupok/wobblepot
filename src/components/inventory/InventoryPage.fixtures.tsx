import { render } from '@testing-library/react'

import { createQueryWrapper } from '@/test/query-wrapper'

import { InventoryPage } from './InventoryPage'

// Shared by the `InventoryPage.*.test.tsx` files. Each test file mocks
// `next/navigation` and stubs `fetch` itself, because `vi.mock` is per file.

export /** What `loadInventory` hands over for a list with nothing on it. */
const EMPTY_SHOPPING_DATA = {
  windowDays: 7,
  startDate: '2026-02-16',
  endDate: '2026-02-23',
  groups: [],
  initialPurchasedIds: new Set<string>(),
  customItems: [],
}

export function renderPage(overrides: Partial<Parameters<typeof InventoryPage>[0]> = {}) {
  const { wrapper } = createQueryWrapper()
  return render(
    <InventoryPage
      view="shopping"
      pantryItems={[]}
      shoppingData={EMPTY_SHOPPING_DATA}
      {...overrides}
    />,
    { wrapper },
  )
}
