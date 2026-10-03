// `src/app/pantry/loading.tsx` is the same two columns with the other one
// shown on a phone. Change the geometry in both. The list is on the note's
// sheet here too, so the paper does not arrive with the data (HON-1016).
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { RowGroup } from '@/components/ui/row-group'
import { PantryItemRowSkeleton } from '@/components/inventory/PantryItemRowSkeleton'
import { ShoppingItemSkeleton } from '@/components/shopping/ShoppingItemSkeleton'

export default function ShoppingLoading() {
  return (
    <div className="w-full px-4 py-8">
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
 * `PantrySection`'s shape: the Title line, the add search, a group heading,
 * then the rows in one `RowGroup`. `h-7.5` is the Title's `text-xl` line box, which the
 * item count on its baseline does not add to; `h-5` the group heading's
 * caption line, which its plain count does not add to either
 * (`GroupHeading.stories.tsx` › WithTotal measures it).
 */
export function PantryColumnSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex h-7.5 items-center">
        <Skeleton className="h-6 w-32" />
      </div>
      {/* `Input`, `h-11`. */}
      <Skeleton aria-hidden className="h-11 w-full" />
      <div className="flex flex-col gap-2">
        <div className="flex h-5 items-center">
          <Skeleton aria-hidden className="h-3.5 w-24" />
        </div>
        <RowGroup>
          <PantryItemRowSkeleton />
          <PantryItemRowSkeleton />
          <PantryItemRowSkeleton />
          <PantryItemRowSkeleton />
        </RowGroup>
      </div>
    </div>
  )
}

/**
 * `ShoppingSection`'s shape: the Title line and the controls row (two `sm`
 * selects and Copy list, all `h-8`, wrapping as the real row does so a 390px
 * column reserves the second line) on the page, then the note sheet holding
 * the add-item input, a group heading and the ruled rows. The bars on the
 * sheet are `tone="soft"`, as quiet as the rows' hover wash (HON-1016).
 */
export function ShoppingColumnSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex h-7.5 items-center">
          <Skeleton className="h-6 w-40" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton aria-hidden className="h-8 w-37.5" />
          <Skeleton aria-hidden className="h-8 w-37.5" />
          <Skeleton aria-hidden className="h-8 w-28" />
        </div>
      </div>
      <Card data-surface="note">
        <CardContent>
          <div className="flex flex-col gap-6">
            <Skeleton aria-hidden tone="soft" className="h-11 w-full" />
            <div className="flex flex-col gap-2">
              <div className="flex h-5 items-center">
                <Skeleton aria-hidden tone="soft" className="h-3.5 w-24" />
              </div>
              <RowGroup variant="ruled">
                <ShoppingItemSkeleton />
                <ShoppingItemSkeleton />
                <ShoppingItemSkeleton />
                <ShoppingItemSkeleton />
                <ShoppingItemSkeleton />
              </RowGroup>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
