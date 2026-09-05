import { Skeleton } from '@/components/ui/skeleton'

/**
 * Placeholder for a `PantryItem` row, used by `src/app/shopping/loading.tsx`.
 * `PantrySection`'s own `PantryItemRow` is the same box, so this covers both.
 *
 * Mirrors the row's box for the reason `ShoppingItemSkeleton` does, but lands
 * 4px taller: a pantry row carries no `min-h-touch` floor, and its height comes
 * from the two `size="icon-sm"` buttons (32px) plus `p-3` plus the border. The
 * skeleton does not invent a floor the real row does not have.
 *
 * Only the name bar keeps `Skeleton`'s `role="status"` — the two button
 * placeholders are `aria-hidden`, so a row still announces "Loading" once.
 */
export function PantryItemSkeleton() {
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
