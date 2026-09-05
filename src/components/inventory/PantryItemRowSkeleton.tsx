import { Skeleton } from '@/components/ui/skeleton'

/**
 * Placeholder for a `PantryItemRow`, used by `src/app/shopping/loading.tsx`.
 *
 * Mirrors the row's box for the reason `ShoppingItemSkeleton` does — same
 * border, same `p-3`, same content lines — and mirrors the variant this route
 * actually serves: the one carrying the "needed in window" caption, at 70px.
 *
 * Which variant to mirror is a bet, not a fact. `src/app/shopping/page.tsx`
 * always fetches `/api/pantry?days=7|14`, but the caption is per row: it needs
 * a `planned` entry in the window whose meal uses that ingredient. The bet is
 * on the state this screen is normally reached in — a planned week — where the
 * query's `isStaple desc` ordering puts the ingredients a week of meals reuses
 * under exactly these four skeletons. With no plan in the window no row gets a
 * caption and all four are 12px too tall, which is the cost of the bet. The
 * story pins that 12px rather than leaving it to prose.
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
    <div className="flex items-center justify-between rounded-lg border p-3">
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
