// `src/app/pantry/loading.tsx` is the same two columns with the other one
// shown on a phone. Change the geometry in both.
import { Skeleton } from '@/components/ui/skeleton'
import { PantryItemRowSkeleton } from '@/components/inventory/PantryItemRowSkeleton'
import { ShoppingItemSkeleton } from '@/components/shopping/ShoppingItemSkeleton'

export default function ShoppingLoading() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="grid gap-8 md:grid-cols-2">
        {/* Pantry section — the left column from `md`; a phone on `/shopping`
            sees only the list, as `InventoryPage` renders it (HON-776). */}
        <div className="hidden md:block">
          <PantryColumnSkeleton />
        </div>

        {/* Shopping section */}
        <div>
          <ShoppingColumnSkeleton />
        </div>
      </div>
    </div>
  )
}

/**
 * `PantrySection`'s shape: the Title line and its subtitle, the add search,
 * a group heading, then rows at `gap-2`. `h-7.5` is the Title's `text-xl`
 * line box; `h-6` the subtitle's `text-sm` one.
 */
export function PantryColumnSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex h-7.5 items-center">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="flex h-6 items-center">
          <Skeleton aria-hidden className="h-4 w-56" />
        </div>
      </div>
      {/* `Input`, `h-11`. */}
      <Skeleton aria-hidden className="h-11 w-full" />
      <div className="flex flex-col gap-2">
        <div className="flex h-5 items-center">
          <Skeleton aria-hidden className="h-3.5 w-24" />
        </div>
        <div className="flex flex-col gap-2">
          <PantryItemRowSkeleton />
          <PantryItemRowSkeleton />
          <PantryItemRowSkeleton />
          <PantryItemRowSkeleton />
        </div>
      </div>
    </div>
  )
}

/**
 * `ShoppingSection`'s shape: the Title line, the controls row (two `sm`
 * selects, `h-8`), the add-item input, a group heading, then rows at `gap-1`.
 */
export function ShoppingColumnSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex h-7.5 items-center">
          <Skeleton className="h-6 w-40" />
        </div>
        <div className="flex gap-2">
          <Skeleton aria-hidden className="h-8 w-37.5" />
          <Skeleton aria-hidden className="h-8 w-37.5" />
        </div>
      </div>
      <Skeleton aria-hidden className="h-11 w-full" />
      <div className="flex flex-col gap-2">
        <div className="flex h-5 items-center">
          <Skeleton aria-hidden className="h-3.5 w-24" />
        </div>
        <div className="flex flex-col gap-1">
          <ShoppingItemSkeleton />
          <ShoppingItemSkeleton />
          <ShoppingItemSkeleton />
          <ShoppingItemSkeleton />
          <ShoppingItemSkeleton />
        </div>
      </div>
    </div>
  )
}
