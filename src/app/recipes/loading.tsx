import { Skeleton } from '@/components/ui/skeleton'

export default function RecipesLoading() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mx-auto max-w-4xl">
        {/* Header with title and action buttons */}
        <div className="mb-6 flex items-center justify-between">
          <Skeleton className="h-9 w-28" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24 rounded-md" />
            <Skeleton className="h-9 w-32 rounded-md" />
          </div>
        </div>

        {/* Search bar */}
        <Skeleton className="mb-6 h-10 w-full rounded-md" />

        {/* Meal cards */}
        <div className="flex flex-col gap-4">
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      </div>
    </div>
  )
}
