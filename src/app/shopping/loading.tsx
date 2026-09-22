import { Skeleton } from '@/components/ui/skeleton'
import { PantryItemRowSkeleton } from '@/components/inventory/PantryItemRowSkeleton'
import { ShoppingItemSkeleton } from '@/components/shopping/ShoppingItemSkeleton'

export default function ShoppingLoading() {
  return (
    <div className="container mx-auto max-w-6xl p-4">
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
