import { Skeleton } from '@/components/ui/skeleton'
import { PantryItemSkeleton } from '@/components/pantry/PantryItemSkeleton'
import { ShoppingItemSkeleton } from '@/components/shopping/ShoppingItemSkeleton'

export default function ShoppingLoading() {
  return (
    <div className="container mx-auto max-w-6xl p-4">
      <div className="grid gap-6 md:grid-cols-2">
        {/* Pantry section */}
        <div className="order-2 md:order-1">
          <Skeleton className="mb-4 h-7 w-24" />
          <div className="flex flex-col gap-3">
            <PantryItemSkeleton />
            <PantryItemSkeleton />
            <PantryItemSkeleton />
            <PantryItemSkeleton />
          </div>
        </div>

        {/* Shopping section */}
        <div className="order-1 md:order-2">
          <Skeleton className="mb-4 h-7 w-32" />
          <div className="flex flex-col gap-3">
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
