import { Skeleton } from '@/components/ui/skeleton'
import { PantryItemRowSkeleton } from '@/components/inventory/PantryItemRowSkeleton'
import { ShoppingItemSkeleton } from '@/components/shopping/ShoppingItemSkeleton'

export default function ShoppingLoading() {
  return (
    <div className="container mx-auto max-w-6xl p-4">
      {/* `InventoryPage` opens with a mobile-only "Back to plan" row — a `sm`
          Button, so `h-8` — above the grid. Without it the whole grid sat 48px
          too high on mobile and dropped when the real page took over. */}
      <div className="mb-4 md:hidden">
        <Skeleton className="h-8 w-32 rounded-md" />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Pantry section */}
        <div className="order-2 md:order-1">
          <Skeleton className="mb-4 h-7 w-24" />
          {/* `gap-2` is what `PantrySection` stacks its rows at. */}
          <div className="flex flex-col gap-2">
            <PantryItemRowSkeleton />
            <PantryItemRowSkeleton />
            <PantryItemRowSkeleton />
            <PantryItemRowSkeleton />
          </div>
        </div>

        {/* Shopping section */}
        <div className="order-1 md:order-2">
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
