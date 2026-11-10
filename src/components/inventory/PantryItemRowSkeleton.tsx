import { Skeleton } from '@/components/ui/skeleton'

/**
 * Placeholder for a `PantryItemRow`, used by `src/app/shopping/loading.tsx`.
 *
 * Mirrors the row's box for the reason `ShoppingItemSkeleton` does — same
 * `p-3`, same content lines, the border left to the `RowGroup` around it — and
 * mirrors the variant this route actually serves: the one carrying the "needed
 * in window" caption and the stock control. It uses the row's own grid and
 * `@container` breakpoint, so it takes both layouts: in a row 28rem wide the
 * control sits on the name line (76px), and in a narrower one it goes under
 * the meta line (112px, HON-1643).
 *
 * Which variant to mirror is a bet, not a fact. `src/app/shopping/page.tsx`
 * always fetches `/api/pantry?days=7|14`, but the caption is per row: it needs
 * a `planned` entry in the window whose meal uses that ingredient. The bet is
 * on the state this screen is normally reached in — a planned week — where the
 * pantry's staples-first ordering puts the ingredients a week of meals reuses
 * under exactly these four skeletons. With no plan in the window no row gets a
 * caption and all four are 20px too tall, which is the cost of the bet. The
 * story pins that 16px rather than leaving it to prose.
 *
 * Colocated with `PantryItemRow.tsx` (rendered by `PantrySection`), the row it
 * copies — `components/pantry/PantryItem.tsx` looks like the counterpart but has
 * no callsite on this screen or any other.
 *
 * Only the name bar keeps `Skeleton`'s `role="status"` — the rest are
 * `aria-hidden`, so a row still announces "Loading" once.
 */
export function PantryItemRowSkeleton() {
  return (
    <div className="@container p-3">
      <div className="grid-cols-pantry-row @md:grid-cols-pantry-row-wide grid items-center gap-x-3">
        {/* Staple star toggle — `Button size="icon-sm"`, so `size-8`. */}
        <Skeleton aria-hidden className="col-start-1 row-start-1 size-8" />
        {/* The name's `leading-7` line box, in a line the 32px buttons set. */}
        <div className="col-start-2 row-start-1 flex h-7 min-w-0 items-center">
          <Skeleton className="h-5 w-28" />
        </div>
        {/* The caption's `text-xs` line box (the HON-686 line height). */}
        <div className="col-span-2 col-start-2 row-start-2 flex h-5 items-center @md:col-span-3 @md:col-start-2">
          <Skeleton aria-hidden className="h-4 w-20" />
        </div>
        {/* The stock control's 28px `xs-touch` parts: on the name line when
            wide, under the meta line, lined up with the name, when narrow. */}
        <div className="col-span-2 col-start-2 row-start-3 mt-2 @md:col-span-1 @md:col-start-3 @md:row-start-1 @md:mt-0">
          <Skeleton aria-hidden className="h-7 w-48" />
        </div>
        {/* ⋯, same `icon-sm` size. */}
        <Skeleton aria-hidden className="col-start-3 row-start-1 size-8 @md:col-start-4" />
      </div>
    </div>
  )
}
