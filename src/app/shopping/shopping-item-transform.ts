import type { Unit } from '@/generated/prisma/enums'
import type { ShoppingItemData } from '@/components/shopping/ShoppingItem'

/**
 * One item as `/api/shopping-list` returns it: everything `ShoppingItem` renders,
 * plus the raw figures the client never uses. Extending `ShoppingItemData` rather
 * than restating its fields is what keeps the two in step — a field added to the
 * component's data shape is picked up here for free.
 */
export interface ShoppingListApiItem extends ShoppingItemData {
  quantity: number
  unit: Unit
  mealCount: number
}

/**
 * Narrow an API item to what the client tree consumes, dropping only the raw
 * figures no component reads (they would otherwise ride along in the RSC payload).
 *
 * Written as a rest-spread on purpose. The previous version enumerated the seven
 * fields it kept, which silently dropped `isVague` and left vague quantities
 * un-italicised on `/shopping` even though the lib, the API route, and
 * `ShoppingItem` all handled it correctly (HON-631). Removing named fields, rather
 * than listing kept ones, means the next field added to `ShoppingItemData` arrives
 * without a second edit here.
 */
export function toShoppingItemData(item: ShoppingListApiItem): ShoppingItemData {
  const { quantity: _quantity, unit: _unit, mealCount: _mealCount, ...itemData } = item
  return itemData
}
