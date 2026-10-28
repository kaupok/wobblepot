import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { PantrySection } from './PantrySection'
import { createQueryWrapper } from '@/test/query-wrapper'
import type { PantryItemData } from '@/components/pantry/PantryItem'

export function makeItem(overrides: Partial<PantryItemData> = {}): PantryItemData {
  return {
    id: 'pantry-1',
    ingredient: { id: 'ing-1', name: 'Butter', category: 'dairy', defaultUnit: 'g' },
    quantity: null,
    isStaple: false,
    updatedAt: '2026-09-24T10:00:00.000Z',
    neededQuantity: 50,
    neededDisplayQuantity: '50g',
    windowDays: 7,
    ...overrides,
  }
}

export function renderSection(items: PantryItemData[], onItemsChange = vi.fn()) {
  const { wrapper } = createQueryWrapper()
  return render(<PantrySection items={items} onItemsChange={onItemsChange} />, { wrapper })
}

/** The group a row's name sits in, read from the heading over its `RowGroup`. */
export function groupOf(name: string) {
  const group = screen.getByText(name).closest('.flex-col.gap-2')
  return group?.querySelector('h3')?.textContent
}

/** Holds the list in state, as `InventoryPage` does, so a row can move. */
function StatefulSectionWithRefresh({
  initial,
  onPantryQuantityChanged,
}: {
  initial: PantryItemData[]
  onPantryQuantityChanged?: () => void
}) {
  const [items, setItems] = useState(initial)
  return (
    <PantrySection
      items={items}
      onItemsChange={setItems}
      onPantryQuantityChanged={onPantryQuantityChanged}
    />
  )
}

export function renderStateful(items: PantryItemData[], onPantryQuantityChanged = vi.fn()) {
  const { wrapper } = createQueryWrapper()
  return render(
    <StatefulSectionWithRefresh
      initial={items}
      onPantryQuantityChanged={onPantryQuantityChanged}
    />,
    { wrapper },
  )
}
