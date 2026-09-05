import { Skeleton } from '@/components/ui/skeleton'

/**
 * Placeholder for a `ShoppingItem` row, used by `src/app/shopping/loading.tsx`.
 * `CustomShoppingItem` shares the same box, so this stands in for both.
 *
 * It mirrors the row's **box** rather than just its height — same border, same
 * `p-3`, same content line — because a solid `Skeleton` bar cannot land on the
 * row's 54px from spacing utilities alone. `h-10` was 14px short (HON-628), and
 * a bar sized to `min-h-touch` would still be 10px short: `min-h-touch` is only
 * a floor, and the real row clears it on content.
 *
 * Colocated with `ShoppingItem.tsx` on purpose. The desync it fixes survived
 * two touch-target passes because nothing in the row's own file pointed at its
 * copy; `ShoppingItemSkeleton.stories.tsx` is what now fails when they drift.
 *
 * `Skeleton` renders `role="status"` on every bar, so the decorative ones are
 * `aria-hidden`: a row announces "Loading" once, as it did when it was a single
 * bar, instead of three times (`tests/e2e/README.md` — specs count these).
 */
export function ShoppingItemSkeleton() {
  return (
    <div className="min-h-touch flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="flex items-center gap-3">
        {/* The `Checkbox`, `h-5 w-5` at the callsite. */}
        <Skeleton aria-hidden className="size-5 shrink-0 rounded-sm" />
        {/* `h-7` is the `leading-7` line box the item name sits in — that box,
            plus `p-3` and the border, is where the row's height comes from. The
            bar inside is text-sized so the row still reads as a row. */}
        <div className="flex h-7 items-center">
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      {/* The "today" / "next week" urgency label. */}
      <Skeleton aria-hidden className="h-4 w-12 shrink-0" />
    </div>
  )
}
