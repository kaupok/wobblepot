import { Skeleton } from '@/components/ui/skeleton'

export default function MealPlanLoading() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-6">
        {/* Week tabs */}
        <div className="flex gap-2">
          <Skeleton className="h-10 w-28 rounded-lg" />
          <Skeleton className="h-10 w-28 rounded-lg" />
          <Skeleton className="h-10 w-28 rounded-lg" />
        </div>

        {/* Day cards grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3 rounded-lg border p-4">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-20 w-full rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
