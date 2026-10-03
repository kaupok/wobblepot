import { RowGroup } from '@/components/ui/row-group'
import { Skeleton } from '@/components/ui/skeleton'

// Mirrors `page.tsx`: same container, title and description, then two past
// days of one heading and a `RowGroup` of rows each, as `PastMealsList` draws
// them (HON-1018).
export default function PastMealsLoading() {
  return (
    <div className="w-full px-4 py-8">
      <div className="flex flex-col gap-6">
        {/* Title (h-7, as /profile) and description */}
        <div className="flex flex-col gap-1">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-5 w-full max-w-sm" />
        </div>

        <div className="flex flex-col gap-8">
          {[3, 2].map((rows, day) => (
            <div key={day} className="flex flex-col gap-2">
              {/* The day heading: `section`, a `text-base` line box. */}
              <div className="flex h-6 items-center">
                <Skeleton aria-hidden className="h-5 w-40" />
              </div>
              <RowGroup>
                {Array.from({ length: rows }, (_, row) => (
                  <PastMealRowSkeleton key={row} />
                ))}
              </RowGroup>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * `PastMealRow`'s box: the same padding and wrap, the slot caption's `text-xs`
 * line over the name's `leading-7` line, and the two outline buttons at
 * `Button`'s default height (`h-touch`, 40px from `md`).
 */
function PastMealRowSkeleton() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2">
      <div className="flex flex-col">
        <div className="flex h-4 items-center">
          <Skeleton aria-hidden className="h-3 w-16" />
        </div>
        <div className="flex h-7 items-center">
          <Skeleton className="h-5 w-48" />
        </div>
      </div>
      <div className="flex gap-2">
        <Skeleton aria-hidden className="h-touch w-28 md:h-10" />
        <Skeleton aria-hidden className="h-touch w-28 md:h-10" />
      </div>
    </div>
  )
}
