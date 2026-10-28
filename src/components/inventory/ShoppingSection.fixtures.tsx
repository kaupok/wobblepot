import { render } from '@testing-library/react'
import { ShoppingSection } from './ShoppingSection'
import { createQueryWrapper } from '@/test/query-wrapper'
import type { IngredientCategory } from '@/generated/prisma/enums'
import type { ShoppingItemData } from '@/components/shopping/ShoppingItem'

// Shared by the `ShoppingSection.*.test.tsx` files. Each test file sets up its
// own `vi.mock` calls, since those are hoisted per file.

export function makeItem(name: string, ingredientId: string, purchased = false): ShoppingItemData {
  return {
    ingredientId,
    name,
    displayQuantity: '100 g',
    purchased,
    neededByDate: '2026-02-18',
    neededByRelative: 'Wed',
    neededByAbsolute: 'Feb 18',
  }
}

export function makeGroup(
  category: IngredientCategory,
  label: string,
  items: ReturnType<typeof makeItem>[],
): { category: IngredientCategory; categoryLabel: string; items: ReturnType<typeof makeItem>[] } {
  return { category, categoryLabel: label, items }
}

export const defaultProps = {
  windowDays: 7,
  startDate: '2026-02-16',
  endDate: '2026-02-23',
  groups: [
    makeGroup('vegetable', 'Vegetable', [makeItem('Carrot', 'v1'), makeItem('Asparagus', 'v2')]),
    makeGroup('protein', 'Protein', [makeItem('Beef', 'p1')]),
  ],
  initialPurchasedIds: new Set<string>(),
}

export function renderSection(overrides: Partial<Parameters<typeof ShoppingSection>[0]> = {}) {
  const { wrapper } = createQueryWrapper()
  return render(<ShoppingSection {...defaultProps} {...overrides} />, { wrapper })
}
