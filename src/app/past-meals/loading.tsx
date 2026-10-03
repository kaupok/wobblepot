import { Skeleton } from '@/components/ui/skeleton'

// Mirrors `page.tsx`: same container, title and description, then two past
// days of one heading and one meal card each.
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
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton shape="card" className="h-28 w-full" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton shape="card" className="h-28 w-full" />
          </div>
        </div>
      </div>
    </div>
  )
}
