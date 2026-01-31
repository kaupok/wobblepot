import { Skeleton } from '@/components/ui/skeleton'

export default function HomeLoading() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left column: meals */}
        <div className="flex flex-col gap-6">
          {/* Today's meals heading */}
          <Skeleton className="h-8 w-40" />

          {/* Meal cards */}
          <div className="flex flex-col gap-4">
            <Skeleton className="h-28 w-full rounded-lg" />
            <Skeleton className="h-28 w-full rounded-lg" />
          </div>

          {/* Tomorrow preview heading */}
          <Skeleton className="h-7 w-48" />

          {/* Tomorrow meal cards */}
          <div className="flex flex-col gap-4">
            <Skeleton className="h-28 w-full rounded-lg" />
          </div>
        </div>

        {/* Right column: shopping summary */}
        <div className="flex flex-col gap-6">
          <Skeleton className="h-7 w-36" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  )
}
