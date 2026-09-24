import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PantrySection } from './PantrySection'
import { createQueryWrapper } from '@/test/query-wrapper'
import type { PantryItemData } from '@/components/pantry/PantryItem'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

function makeItem(overrides: Partial<PantryItemData> = {}): PantryItemData {
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

function renderSection(items: PantryItemData[]) {
  const { wrapper } = createQueryWrapper()
  return render(<PantrySection items={items} onItemsChange={vi.fn()} />, { wrapper })
}

describe('PantrySection needed line', () => {
  it('shows the quantity for a numeric need', () => {
    renderSection([makeItem()])

    expect(screen.getByText('50g needed in next 7 days')).toBeInTheDocument()
  })

  // A vague quantity's display is the phrase itself, which read "to taste
  // needed in next 7 days" (HON-783).
  it('drops the phrase for a vague need', () => {
    renderSection([
      makeItem({
        id: 'pantry-2',
        ingredient: { id: 'ing-2', name: 'Black pepper', category: 'spice', defaultUnit: 'g' },
        isStaple: true,
        neededQuantity: 1,
        neededDisplayQuantity: 'to taste',
        isVague: true,
      }),
    ])

    expect(screen.getByText('Needed in next 7 days')).toBeInTheDocument()
    expect(screen.queryByText(/to taste/)).not.toBeInTheDocument()
  })
})
