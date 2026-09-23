// The same two columns as `src/app/shopping/loading.tsx`; only which one a
// phone sees differs. Change the geometry in both (CLAUDE.md → Shared-primitive
// geometry).
import { Skeleton } from '@/components/ui/skeleton'
import { PantryItemRowSkeleton } from '@/components/inventory/PantryItemRowSkeleton'
import { ShoppingItemSkeleton } from '@/components/shopping/ShoppingItemSkeleton'

export default function PantryLoading() {
  return (
    <div className="container mx-auto max-w-6xl p-4">
      <div className="grid gap-6 md:grid-cols-2">
        {/* Pantry section — all a phone sees on `/pantry` (HON-776). */}
        <div>
          <Skeleton className="mb-4 h-7 w-24" />
          {/* `gap-2` is what `PantrySection` stacks its rows at. */}
          <div className="flex flex-col gap-2">
            <PantryItemRowSkeleton />
            <PantryItemRowSkeleton />
            <PantryItemRowSkeleton />
            <PantryItemRowSkeleton />
          </div>
        </div>

        {/* Shopping section — the right column from `md`, as on `/shopping`. */}
        <div className="hidden md:block">
          <Skeleton className="mb-4 h-7 w-32" />
          {/* `gap-1` is what `CategoryGroup` and `UrgencyGroup` stack rows at. */}
          <div className="flex flex-col gap-1">
            <ShoppingItemSkeleton />
            <ShoppingItemSkeleton />
            <ShoppingItemSkeleton />
            <ShoppingItemSkeleton />
            <ShoppingItemSkeleton />
          </div>
        </div>
      </div>
    </div>
  )
}
