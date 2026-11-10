import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { vi } from 'vitest'

import type { PantryItemData } from '@/components/pantry/PantryItem'
import { createQueryWrapper } from '@/test/query-wrapper'

import { PantrySection } from './PantrySection'

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

/** A pantry row, the `@container` box around its lines. */
export function rowOf(name: string) {
  return screen.getByText(name).closest<HTMLElement>('.\\@container')!
}

/** A row's ⋯ button, which holds Add amount and Remove (HON-1643). */
export function moreActions(name: string) {
  return screen.getByRole('button', { name: `More actions: ${name}` })
}

export type RowAction = 'Add amount' | 'Change amount' | 'Remove'

/** The items a row's ⋯ menu holds, read with the menu open. */
export async function rowActions(name: string): Promise<string[]> {
  const trigger = moreActions(name)
  trigger.focus()
  // Radix opens the menu on keydown or pointerdown, not on a click.
  fireEvent.keyDown(trigger, { key: 'Enter' })
  const items = await screen.findAllByRole('menuitem')
  return items.map((item) => item.textContent ?? '')
}

/**
 * Picks an item from a row's ⋯ menu. The row runs the action once the menu
 * has closed, and Radix closes it a task later, so this waits for that task.
 */
export async function chooseRowAction(name: string, action: RowAction | RegExp) {
  const trigger = moreActions(name)
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitem', { name: action }))
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
}

export type StockLabel = 'Have it' | 'Low' | 'Ran out'

/** A row's stock control, Have it · Low · Ran out (HON-1624). */
export function stockOf(name: string) {
  return screen.getByRole('radiogroup', { name: `Stock: ${name}` })
}

/** One part of a row's stock control. */
export function stockPart(name: string, label: StockLabel) {
  return within(stockOf(name)).getByRole('radio', { name: label })
}

/** The part of a row's stock control that is pressed. */
export function pressedStock(name: string) {
  return within(stockOf(name)).getByRole('radio', { checked: true })
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
