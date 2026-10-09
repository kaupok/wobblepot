import { Skeleton } from '@/components/ui/skeleton'
import { RecipesGridSkeleton } from './RecipesGridSkeleton'

// Mirrors `RecipesPageClient`: same container, top-aligned, no bordered
// wrapper (HON-767, HON-747). Bar heights match each rendered line box.
export default function RecipesLoading() {
  return (
    <div className="flex w-full flex-col gap-6 px-4 py-8">
      {/* Title (h-7, as /household) with the recipe count beside it, and the description */}
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-3">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-5 w-20" />
        </div>
        <Skeleton className="h-5 w-64" />
      </div>

      {/* Search and actions on one row from `sm`; below it Import has its own
          row and Create and Imagine are two-up under it, as `RecipesPageClient`
          lays them out (HON-812, HON-1128) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-touch w-full sm:max-w-md sm:flex-1 md:h-10" />
        <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
          <Skeleton className="h-touch col-span-2 w-full sm:w-32 md:h-10" />
          <Skeleton className="h-touch w-full sm:w-32 md:h-10" />
          <Skeleton className="h-touch w-full sm:w-32 md:h-10" />
        </div>
      </div>

      <RecipesGridSkeleton />
    </div>
  )
}
