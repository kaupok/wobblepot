import { Skeleton } from '@/components/ui/skeleton'

/**
 * Placeholder for a `PantryItemRow`, used by `src/app/shopping/loading.tsx`.
 *
 * Mirrors the row's box for the reason `ShoppingItemSkeleton` does — same
 * border, same `p-3`, same content lines — and mirrors the variant this route
 * actually serves: the one carrying the "needed in window" caption, at 70px.
 *
 * That variant is not the exception here. `src/app/shopping/page.tsx` always
 * fetches `/api/pantry?days=7|14`, so the caption branch is live on every load;
 * it fires for any pantry ingredient a planned meal needs, and the query sorts
 * `isStaple desc`, so the rows these four skeletons stand in for are the
 * staples — the ingredients a week of meals is most likely to reuse. A row
 * whose ingredient the plan does not need renders 12px shorter; the story pins
 * that delta rather than leaving it to prose.
 *
 * Colocated with `PantrySection.tsx` because that is where the row it copies
 * lives — `components/pantry/PantryItem.tsx` looks like the counterpart but has
 * no callsite on this screen or any other.
 *
 * Only the name bar keeps `Skeleton`'s `role="status"` — the rest are
 * `aria-hidden`, so a row still announces "Loading" once.
 */
export function PantryItemRowSkeleton() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="flex items-center gap-3">
        {/* Staple star toggle — `Button size="icon-sm"`, so `size-8`. */}
        <Skeleton aria-hidden className="size-8 shrink-0 rounded-md" />
        {/* The name's `leading-7` line box over the caption's `text-xs` one:
            28 + 16 = 44, which is what carries the row past its buttons. */}
        <div className="flex flex-col">
          <div className="flex h-7 items-center">
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="flex h-4 items-center">
            <Skeleton aria-hidden className="h-3 w-20" />
          </div>
        </div>
      </div>
      {/* Remove button, same `icon-sm` size. */}
      <Skeleton aria-hidden className="size-8 shrink-0 rounded-md" />
    </div>
  )
}
