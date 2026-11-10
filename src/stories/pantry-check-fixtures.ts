import type { PantryCheckRow } from '@/components/inventory/PantryCheckList'

/**
 * The check above To buy (HON-1585): a staple and two "have some" needs, one
 * of them a herb kept at home by two rows (HON-1558). `pantryCheckRowsMarked`
 * has one marked low and one ran out (HON-1638). For `PantryCheckList`,
 * `UrgentShopping` and `ShoppingSection`.
 */
export const pantryCheckRows: PantryCheckRow[] = [
  {
    ingredientId: 'garlic',
    name: 'Garlic',
    displayQuantity: '30g',
    mealCount: 3,
    neededByDate: '2026-11-02',
    neededByRelative: 'tomorrow',
    pantryRows: [{ id: 'pantry-garlic', quantity: null, low: false }],
    isStaple: true,
    stock: 'haveIt',
  },
  {
    ingredientId: 'carrot',
    name: 'Carrot',
    displayQuantity: '~20 pcs',
    mealCount: 4,
    neededByDate: '2026-11-03',
    neededByRelative: 'Tuesday',
    pantryRows: [{ id: 'pantry-carrot', quantity: null, low: false }],
    isStaple: false,
    stock: 'haveIt',
  },
  {
    ingredientId: 'basil',
    name: 'Basil',
    displayQuantity: '20g',
    mealCount: 2,
    neededByDate: '2026-11-04',
    neededByRelative: 'Wednesday',
    pantryRows: [
      { id: 'pantry-basil', quantity: null, low: false },
      { id: 'pantry-fresh-basil', quantity: null, low: false },
    ],
    isStaple: false,
    stock: 'haveIt',
  },
]

export const pantryCheckRowsMarked: PantryCheckRow[] = pantryCheckRows.map((row) =>
  row.ingredientId === 'carrot'
    ? { ...row, pantryRows: [{ id: 'pantry-carrot', quantity: null, low: true }], stock: 'low' }
    : row.ingredientId === 'basil'
      ? {
          ...row,
          pantryRows: [
            { id: 'pantry-basil', quantity: 0, low: false },
            { id: 'pantry-fresh-basil', quantity: 0, low: false },
          ],
          stock: 'ranOut',
        }
      : row,
)
