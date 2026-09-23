import { Skeleton } from '@/components/ui/skeleton'
import { RecipesGridSkeleton } from './RecipesGridSkeleton'

// Mirrors `RecipesPageClient`: same container, top-aligned, no bordered
// wrapper (HON-767, HON-747). Bar heights match each rendered line box.
export default function RecipesLoading() {
  return (
    <div className="container mx-auto flex flex-col gap-6 px-4 py-8">
      {/* Title (h-7, as /household) and description */}
      <div className="flex flex-col gap-1">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-6 w-64" />
      </div>

      {/* Search */}
      <Skeleton className="h-touch w-full md:h-10" />

      {/* Recipe count and actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-6 w-24" />
        <div className="flex gap-2">
          <Skeleton className="h-touch w-32 md:h-10" />
          <Skeleton className="h-touch w-32 md:h-10" />
        </div>
      </div>

      <RecipesGridSkeleton />
    </div>
  )
}
