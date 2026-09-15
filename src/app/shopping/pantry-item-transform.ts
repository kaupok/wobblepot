import type { PantryItemData } from '@/components/pantry/PantryItem'

/**
 * One item as `/api/pantry` returns it: everything `PantryItem` renders, plus the
 * fields no pantry component reads. Extending `PantryItemData` rather than
 * restating its fields is what keeps the two in step — a field added to the
 * component's data shape is picked up here for free.
 *
 * `updatedAt` is a string once it has crossed `NextResponse.json`, but the route
 * builds it from a Prisma `Date`, so both are accepted.
 */
export interface PantryApiItem extends Omit<PantryItemData, 'updatedAt'> {
  updatedAt: string | Date
  /** Duplicates `ingredient.id`. */
  ingredientId: string
  /** Only present alongside the window fields; no pantry surface styles on it. */
  isVague?: boolean
}

/**
 * Narrow an API item to what the pantry section consumes, dropping only the
 * fields no component reads (they would otherwise ride along in the RSC payload).
 *
 * Written as a rest-spread on purpose, for the same reason as
 * `toShoppingItemData`: the enumerated projection it replaces silently dropped
 * `isVague`, the exact shape of defect HON-631 fixed on the shopping side.
 * Removing named fields, rather than listing kept ones, means the next field
 * added to `PantryItemData` arrives without a second edit here (HON-656).
 */
export function toPantryItemData(item: PantryApiItem): PantryItemData {
  const { ingredientId: _ingredientId, isVague: _isVague, updatedAt, ...itemData } = item
  return {
    ...itemData,
    updatedAt: typeof updatedAt === 'string' ? updatedAt : updatedAt.toISOString(),
  }
}
