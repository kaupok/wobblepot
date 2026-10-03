import { Skeleton } from '@/components/ui/skeleton'

/**
 * Placeholder for a `ShoppingItem` row, used by `src/app/shopping/loading.tsx`.
 * `CustomShoppingItem` shares the same box, so this stands in for both.
 *
 * It mirrors the row's **box** rather than just its height — same padding,
 * same floor, same content line — because the row's height comes from its
 * content plus padding, and differs by pointer type: 44px on touch
 * (`leading-7` line plus `py-2`), 36px with a mouse (`pointer-fine:py-1`,
 * HON-1017). A single bar sized to one number would be wrong on the other
 * pointer, as `h-10` was 12px short of the old row (HON-628). The row sits in
 * a `RowGroup variant="ruled"`, which draws no dividers, as in the live list.
 * The row only ever sits on the list's note sheet, so its bars are
 * `tone="soft"`: a full-accent bar there is louder than the rows it stands
 * in for (HON-1016).
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
    <div className="min-h-touch flex items-center justify-between gap-3 px-3 py-2 pointer-fine:min-h-9 pointer-fine:py-1">
      <div className="flex items-center gap-3">
        {/* The `Checkbox`, `size-5` by default. */}
        <Skeleton aria-hidden tone="soft" shape="checkbox" className="size-5 shrink-0" />
        {/* `h-7` is the `leading-7` line box the item name sits in — that box
            plus the vertical padding is where the row's height comes from.
            The bar inside is text-sized so the row still reads as a row. */}
        <div className="flex h-7 items-center">
          <Skeleton tone="soft" className="h-5 w-32" />
        </div>
      </div>
      {/* The "today" / "next week" urgency label, a `text-xs` caption. */}
      <Skeleton aria-hidden tone="soft" className="h-4 w-12 shrink-0" />
    </div>
  )
}
