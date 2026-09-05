import { Skeleton } from '@/components/ui/skeleton'

/**
 * Placeholder for a `PantryItemRow`, used by `src/app/shopping/loading.tsx`.
 *
 * Mirrors the row's box for the reason `ShoppingItemSkeleton` does, but lands
 * 4px taller: a pantry row carries no `min-h-touch` floor, and its height comes
 * from the two `size="icon-sm"` buttons (32px) plus `p-3` plus the border. The
 * skeleton does not invent a floor the real row does not have.
 *
 * It mirrors the row **without** its "needed in window" caption, which is the
 * row's floor at 58px. A row whose ingredient the plan needs stacks a `text-xs`
 * caption under the name and renders 70px (`/api/pantry` attaches those fields
 * only when `neededQuantity > 0`), and no loading state can know which rows
 * those will be. Colocated with `PantrySection.tsx` because that is where the
 * row it copies lives — `components/pantry/PantryItem.tsx` looks like the
 * counterpart but has no callsite on this screen or any other.
 *
 * Only the name bar keeps `Skeleton`'s `role="status"` — the two button
 * placeholders are `aria-hidden`, so a row still announces "Loading" once.
 */
export function PantryItemRowSkeleton() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="flex items-center gap-3">
        {/* Staple star toggle — `Button size="icon-sm"`, so `size-8`. */}
        <Skeleton aria-hidden className="size-8 shrink-0 rounded-md" />
        <Skeleton className="h-4 w-28" />
      </div>
      {/* Remove button, same `icon-sm` size. */}
      <Skeleton aria-hidden className="size-8 shrink-0 rounded-md" />
    </div>
  )
}
